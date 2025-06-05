import prisma from "../prisma";

interface PedidoCreateData {
  quantidade: number;
  material: string;
  dataEmissao: string | Date;
  operacao: string;
  clienteId: string; // agora é string simples
  itemId: string;
  status?: string;
}

export class PedidoService {
  async create(data: PedidoCreateData) {
    if (
      !data.quantidade ||
      !data.material ||
      !data.dataEmissao ||
      !data.operacao ||
      !data.clienteId ||
      !data.itemId
    ) {
      throw new Error("Campos obrigatórios faltando");
    }

    const dataEmissaoDate =
      data.dataEmissao instanceof Date ? data.dataEmissao : new Date(data.dataEmissao);

    return await prisma.pedido.create({
      data: {
        quantidade: data.quantidade,
        material: data.material,
        dataEmissao: dataEmissaoDate,
        operacao: data.operacao,
        clienteId: data.clienteId, // string agora
        itemId: data.itemId,
        status: data.status,
      },
    });
  }

  async listAll() {
    return await prisma.pedido.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        item: true,
      },
    });
  }

  async getById(id: string) {
    return await prisma.pedido.findUnique({
      where: { id },
      include: { item: true },
    });
  }

  async delete(id: string) {
    return await prisma.pedido.delete({ where: { id } });
  }
}
