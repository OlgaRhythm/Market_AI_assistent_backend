// Статическая OpenAPI-спека, написанная вручную по реальным DTO и контроллеру
// (SupportRequestDto, SupportResponseDto, support.controller.ts). Не
// генерируется автоматически — при изменении контрактов нужно обновлять и
// этот файл.
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "AI Support Assistant — Backend API",
    version: "1.0.0",
    description:
      "Backend для AI-ассистента поддержки маркетплейса. Принимает сообщения пользователя, классифицирует намерение, отвечает из базы знаний или просит уточнить заказ/передаёт оператору.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "health", description: "Проверка доступности сервиса" },
    { name: "support", description: "Диалог с AI-ассистентом" },
    { name: "orders", description: "Заказы пользователя" },
  ],
  paths: {
    "/hello": {
      get: {
        tags: ["health"],
        summary: "Проверка, что сервис запущен",
        responses: {
          "200": {
            description: "Сервис работает",
            content: { "text/plain": { schema: { type: "string", example: "hello!" } } },
          },
        },
      },
    },
    "/support": {
      post: {
        tags: ["support"],
        summary: "Отправить сообщение AI-ассистенту",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SupportRequest" },
              examples: {
                default: {
                  value: { userId: 7, sessionId: 1001, message: "Where is my order?" },
                },
                withOrderId: {
                  value: {
                    userId: 7,
                    sessionId: 1001,
                    message: "Where is my order?",
                    orderId: 3,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Ответ ассистента",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SupportResponse" } },
            },
          },
          "400": {
            description: "Ошибка валидации входных данных",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } },
            },
          },
          "500": {
            description:
              "Внутренняя ошибка (включая недоступность или ошибку ML-сервиса — backend не различает их структурированно, см. README фронтенда)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/GenericError" } },
            },
          },
        },
      },
    },
    "/orders": {
      get: {
        tags: ["orders"],
        summary: "Получить заказы пользователя",
        parameters: [
          {
            name: "userId",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 1 },
            description: "Положительное целое число",
          },
        ],
        responses: {
          "200": {
            description: "Список заказов пользователя (может быть пустым)",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Order" } },
              },
            },
          },
          "400": {
            description: "userId не передан или не является положительным целым числом",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/GenericError" } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      SupportRequest: {
        type: "object",
        required: ["userId", "message", "sessionId"],
        properties: {
          userId: { type: "integer", description: "ID пользователя" },
          message: {
            type: "string",
            minLength: 3,
            maxLength: 300,
            description: "Текст сообщения пользователя (3–300 символов)",
          },
          sessionId: { type: "integer", description: "ID сессии диалога" },
          orderId: {
            type: "integer",
            nullable: true,
            description:
              "ID заказа — необязателен, учитывается только для категорий, где он нужен (доставка/возврат/заказ)",
          },
        },
      },
      SupportResponse: {
        type: "object",
        properties: {
          text: { type: "string", description: "Текст ответа ассистента" },
          type: {
            type: "integer",
            enum: [1, 2, 3, 4],
            description:
              "1 = ANSWER (обычный ответ), 2 = DETAILSREQUEST (нужны подробности), 3 = ORDERINFOREQUEST (нужен/неверен orderId), 4 = OPERATOR (передано оператору)",
          },
          technical: {
            type: "object",
            nullable: true,
            description: "Диагностическая информация: модель, intent, confidence, тайминги",
            properties: {
              classifier: {
                type: "object",
                nullable: true,
                properties: {
                  model: { type: "string" },
                  intent: { type: "string" },
                  category: { type: "string" },
                  confidence: { type: "number" },
                  inference_ms: { type: "number" },
                  request_ms: { type: "number" },
                },
              },
              generator: {
                type: "object",
                nullable: true,
                properties: {
                  model: { type: "string" },
                  knowledge_lookup_ms: { type: "number" },
                  inference_ms: { type: "number" },
                  request_ms: { type: "number" },
                },
              },
              timings_ms: {
                type: "object",
                properties: {
                  preprocessing: { type: "number" },
                  preprocessing_request: { type: "number" },
                  classification: { type: "number", nullable: true },
                  knowledge_lookup: { type: "number", nullable: true },
                  generation: { type: "number", nullable: true },
                  total: { type: "number" },
                },
              },
            },
          },
        },
      },
      Order: {
        type: "object",
        properties: {
          id: { type: "integer" },
          orderComposition: { type: "string" },
          status: { type: "string" },
          deliveryDate: { type: "string", format: "date-time" },
        },
      },
      ValidationError: {
        type: "object",
        properties: {
          errors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Карта constraint → текст ошибки (class-validator)",
            },
          },
        },
        example: {
          errors: [
            { minLength: "message must be longer than or equal to 3 characters" },
          ],
        },
      },
      GenericError: {
        type: "object",
        properties: { error: { type: "string" } },
        example: { error: "A positive integer userId is required." },
      },
    },
  },
};
