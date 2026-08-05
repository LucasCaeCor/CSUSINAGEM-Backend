import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      name: string;
      email: string;
    };
  }

   interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    
  }
}



export interface FastifyRequestWithUser extends FastifyRequest {
  user?: {
    id: string;
    name: string;
    email: string;
  };
}