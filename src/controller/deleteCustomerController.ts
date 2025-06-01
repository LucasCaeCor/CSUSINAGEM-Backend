import { FastifyRequest, FastifyReply } from "fastify";
import { DeleteCustomerService } from "../services/deleteCustomerService";
import  prisma  from "../prisma";

export class DeleteCustomer  {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };

    try {
      await prisma.customer.delete({
        where: { id },
      });

      return reply.code(200).send({ message: "Cliente deletado com sucesso." });
    } catch (error) {
      return reply.code(500).send({ message: "Erro ao deletar cliente." });
    }
  }
}
