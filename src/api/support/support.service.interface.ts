import { SupportRequestDto } from "./dto/supportRequest.dto";
import { SupportResponseDto } from "./dto/supportResponse.dto";
import { OrderEntity } from "../order/entity/order.entity";

export interface ISupportService {
  handleSupportRequest(requestData: SupportRequestDto, traceId: string): Promise<SupportResponseDto>
  getOrdersForUser(userId: number): Promise<OrderEntity[]>
}