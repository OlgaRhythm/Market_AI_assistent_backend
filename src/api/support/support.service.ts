import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';
import { ISupportRepository } from './support.repository.interface';
import { ISupportService } from './support.service.interface';
import { SupportRequestDto } from './dto/supportRequest.dto';
import { ISessionRepository } from '../session/session.repository.interface';
import { IGatewayService } from '../gateway/gateway.service.interface';
import { MessageEntity, SenderType } from '../messages/entity/message.entity';
import { IMessageRepository } from '../messages/message.repository.interface';
import { SessionEntity, SessionStatus } from '../session/entity/session.entity';
import {
    ResponseType,
    SupportResponseDto,
    SupportTechnicalInfo,
} from './dto/supportResponse.dto';
import { NeedOrderDetailsCategories, RequestCategory } from '../common/ml.enums';
import { IOrderRepository } from '../order/order.repository.interface';
import { performance } from 'node:perf_hooks';
import { ClassificationResult } from '../gateway/gateway.service.interface';
import { log } from '../common/trace';



@injectable()
export class SupportService implements ISupportService {
    constructor(
        @inject(TYPES.supportRepository) private helloRepository: ISupportRepository,
        @inject(TYPES.sessionRepository) private sessionRepository: ISessionRepository,
        @inject(TYPES.gatewayService) private gatewayService: IGatewayService,
        @inject(TYPES.messageRepository) private messageRepository: IMessageRepository,
        @inject(TYPES.orderRepository) private orderRepository: IOrderRepository
    ) {}


    async handleSupportRequest(requestData: SupportRequestDto, traceId: string): Promise<SupportResponseDto>{
        const started = performance.now();
        log(traceId, 'support request', { userId: requestData.userId, sessionId: requestData.sessionId });

        const preprocessing = await this.gatewayService.fixSpelling(requestData.message, traceId);
        requestData.message = preprocessing.text;
        const technical: SupportTechnicalInfo = {
            classifier: null,
            generator: null,
            timings_ms: {
                preprocessing: preprocessing.durationMs,
                preprocessing_request: preprocessing.requestMs,
                classification: null,
                knowledge_lookup: null,
                generation: null,
                total: 0,
            },
        };

        const session = await this.handleSession(requestData);
        await this.saveMessage(requestData, session.id);

        if (session.messages && session.messages.length >= 3){
            const response = await this.answerThatSentToOperator(requestData, traceId, 'message_limit_reached');
            return this.completeResponse(response, technical, started, traceId);
        }

        let context = ((session.messages || []).map((item: any) => item.text).join('. ')) + requestData.message;
        let orderContext: string | undefined;

        const classification = await this.gatewayService.getAICategory(context, traceId);
        this.recordClassification(technical, classification);
        const category = classification.category;

        if (classification.confidence <= 0.3 || (classification.confidence > 0.85 && !category)) { // currently classificator always returns category if succeeded
          const response = await this.answerThatNeedMoreQuestionInfo(requestData);
          return this.completeResponse(response, technical, started, traceId);
        }

        if (
            classification.confidence > 0.85
            && category !== null
            && NeedOrderDetailsCategories.includes(category)
        ) {
            if (!requestData.orderId) {
                const response = await this.answerThatNeedOrderInfo(requestData);
                return this.completeResponse(response, technical, started, traceId);
            }
            const order = await this.orderRepository.getOrder(requestData.orderId, requestData.userId);
            if (!order) {
                const response = await this.answerThatNeedOrderInfo(requestData);
                return this.completeResponse(response, technical, started, traceId);
            }
            const orderInfo = "Order composition: " + order.orderComposition + ". Status: " + order.status + ". Delivery date: " + order.deliveryDate;
            log(traceId, 'order context resolved', { orderId: requestData.orderId });
            orderContext = orderInfo;
            context += orderInfo;
        } else if (
            classification.confidence > 0.85
            && category === RequestCategory.human_agent
        ) {
                const response = await this.answerThatSentToOperator(requestData, traceId, 'human_agent_intent');
                return this.completeResponse(response, technical, started, traceId);
        }

        const response = await this.answerAI(
            requestData,
            context,
            classification.intent,
            technical,
            traceId,
            orderContext,
        );
        return this.completeResponse(response, technical, started, traceId);
    }

    async getOrdersForUser(userId: number) {
        return this.orderRepository.getOrdersForUser(userId);
    }

    private recordClassification(
        technical: SupportTechnicalInfo,
        classification: ClassificationResult,
    ): void {
        technical.classifier = {
            model: classification.model,
            intent: classification.intent,
            category: classification.categoryName,
            confidence: classification.confidence,
            inference_ms: classification.durationMs,
            request_ms: classification.requestMs,
        };
        technical.timings_ms.classification = classification.durationMs;
    }

    private completeResponse(
        response: SupportResponseDto,
        technical: SupportTechnicalInfo,
        started: number,
        traceId: string,
    ): SupportResponseDto {
        technical.timings_ms.total = Number((performance.now() - started).toFixed(3));
        response.technical = technical;
        log(traceId, 'support response', {
            type: ResponseType[response.type],
            totalMs: technical.timings_ms.total,
        });
        return response;
    }

    async saveMessage(requestData: SupportRequestDto, sessionId: number){
        const msg = new MessageEntity();
        msg.senderType = SenderType.USER;
        msg.text = requestData.message;
        msg.sessionId = sessionId;
        const savedMessage = await this.messageRepository.saveMessage(msg);
    }

    async handleSession(requestData: SupportRequestDto): Promise<SessionEntity>{
      let session = await this.sessionRepository.getSession(requestData.sessionId);

        if (!session) {
            session = await this.sessionRepository.createSession(requestData.sessionId, requestData.userId)
        } else if (session.status == SessionStatus.CLOSED){
            await this.sessionRepository.updateStatus(requestData.sessionId, SessionStatus.OPEN);
        }

      return session;
    }


    async answerThatSentToOperator (
        requestData: SupportRequestDto,
        traceId: string,
        reason: string,
    ): Promise<SupportResponseDto>{
        await this.sessionRepository.updateStatus(requestData.sessionId, SessionStatus.OPERATOR);
        log(traceId, 'escalated to operator', { reason });
        await this.gatewayService.sendToOperator(traceId);
            return {
                  type: ResponseType.OPERATOR,
                  text: "Please wait for a response. Your request has been sent to the operator."
            }
    }

    async answerThatNeedOrderInfo (requestData: SupportRequestDto): Promise<SupportResponseDto>{
            return {
                  type: ResponseType.ORDERINFOREQUEST,
                  text: "Please provide or check order Id."
            }
    }

    async answerThatNeedMoreQuestionInfo (requestData: SupportRequestDto): Promise<SupportResponseDto>{
            return {
                  type: ResponseType.DETAILSREQUEST,
                  text: "Please rephrase your question or provide more details."
            }
    }

    async answerAI(
        requestData: SupportRequestDto,
        context: string,
        intent: string,
        technical: SupportTechnicalInfo,
        traceId: string,
        orderContext?: string,
    ): Promise<SupportResponseDto>{
        await this.sessionRepository.updateStatus(requestData.sessionId, SessionStatus.CLOSED);
        const generated = await this.gatewayService.getAIResponse(context, intent, orderContext, traceId);
        technical.generator = {
            model: generated.model,
            knowledge_lookup_ms: generated.knowledgeLookupMs,
            inference_ms: generated.llmDurationMs,
            request_ms: generated.requestMs,
        };
        technical.timings_ms.knowledge_lookup = generated.knowledgeLookupMs;
        technical.timings_ms.generation = generated.durationMs;
        return {
            type: ResponseType.ANSWER,
            text: generated.content,
        }
    }


}
