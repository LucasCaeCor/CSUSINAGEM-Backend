import { FastifyRequest, FastifyReply } from "fastify";
import { PedidoService } from "../services/pedidoService";
import { CreateOrcamentoService } from "../services/CreateOrcamentoService";

interface PedidoBody {
  quantidade: number;
  material: string;
  dataEmissao: string | Date;
  operacao: string;
  itemId: string;
  cliente: string;
  tipo: 'pedido' | 'orcamento';  // ou string se quiser ser mais flexível
  valor?: number;               // se for só do orçamento
}

export class PedidoController {
  async create(request: FastifyRequest<{ Body: PedidoBody }>, reply: FastifyReply) {
    try {
      const { tipo, valor, ...data } = request.body;
      
      if (tipo === 'orcamento') {
        const orcamentoService = new CreateOrcamentoService();
        const orcamento = await orcamentoService.create({ ...data, valor });
        return reply.status(201).send(orcamento);
      } else {
        const pedidoService = new PedidoService();
        const pedido = await pedidoService.create(data);
        return reply.status(201).send(pedido);
      }
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao criar pedido ou orçamento", message: err });
    }
  }

  async listAll(request: FastifyRequest, reply: FastifyReply) {
    try {
      const service = new PedidoService();
      const pedidos = await service.listAll();
      return reply.send(pedidos);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao listar pedidos", message: err });
    }
  }

  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    try {
      const service = new PedidoService();
      const pedido = await service.getById(id);
      if (!pedido) return reply.status(404).send({ error: "Pedido não encontrado" });
      return reply.send(pedido);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao buscar pedido", message: err });
    }
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    try {
      const service = new PedidoService();
      await service.delete(id);
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(404).send({ error: "Erro ao deletar pedido", message: err });
    }
  }
}
