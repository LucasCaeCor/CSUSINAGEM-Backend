import prisma from "../prisma";

interface PedidoCreateData {
  quantidade: number;
  material: string;
  dataEmissao: string | Date;
  operacao: string;
  cliente: string;
  itemId: string;
  status?: string;
  description?: string; // Added description field
}

export class PedidoService {
  async create(data: PedidoCreateData) {
    if (
      !data.quantidade ||
      !data.material ||
      !data.dataEmissao ||
      !data.operacao ||
      !data.cliente ||
      !data.itemId
    ) {
      throw new Error("Campos obrigatórios faltando");
    }

    // Corrigindo a conversão da data
    let dataEmissaoDate: Date;

    if (data.dataEmissao instanceof Date) {
      // Se já for Date, usa diretamente
      dataEmissaoDate = data.dataEmissao;
    } else {
      // Se for string, faz o parse considerando o formato brasileiro
      const [day, month, year] = data.dataEmissao.split('/');
      // Cria a data no UTC para evitar problemas de fuso horário
      dataEmissaoDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }

    return await prisma.pedido.create({
      data: {
        quantidade: data.quantidade,
        material: data.material,
        dataEmissao: dataEmissaoDate,
        operacao: data.operacao,
        cliente: data.cliente,
        itemId: data.itemId,
        description: data.description, // Include description
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
