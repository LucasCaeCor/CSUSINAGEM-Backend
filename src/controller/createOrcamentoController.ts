// createOrcamentoController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import prisma from "../prisma";

export class CreateOrcamentoController {
  async handle(request: FastifyRequest, reply: FastifyReply) {
    const {
      itemId,
      cliente,
      quantidade,
      material,
      dataEmissao,
      operacao,
      valor,
      status,
    } = request.body as {
      itemId: string;
      cliente: string;
      quantidade: number;
      material: string;
      dataEmissao: string;
      operacao: string;
      valor: number;
      status?: string;
    };

    if (!itemId || !cliente || !quantidade || !material || !dataEmissao || !operacao || valor === undefined) {
      return reply.status(400).send({ error: "Campos obrigatórios faltando" });
    }

    try {
      const orcamento = await prisma.orcamento.create({
        data: {
          itemId,
          cliente,
          quantidade,
          material,
          dataEmissao: new Date(dataEmissao),
          operacao,
          valor,
          status: status ?? "PENDENTE"
        },
      });

      return reply.status(201).send(orcamento);
    } catch (error) {
      return reply.status(500).send({ error: "Erro ao criar orçamento", detail: error });
    }
  }
}
