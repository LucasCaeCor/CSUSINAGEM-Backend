import prismaClient from "../prisma";

interface CreateOrcamentoProps {
  quantidade: number;
  material: string;
  dataEmissao: string;
  operacao: string;
  cliente: string;
  itemId: string;
  valor: number;
  status?: string;
}

class CreateOrcamentoService {
  async execute({ quantidade, material, dataEmissao, operacao, cliente, itemId, valor, status }: CreateOrcamentoProps) {
    if (!quantidade || !material || !dataEmissao || !operacao || !cliente || !itemId || !valor) {
      throw new Error("Todos os campos obrigatórios devem ser preenchidos.");
    }

    const orcamento = await prismaClient.orcamento.create({
      data: {
        quantidade,
        material,
        dataEmissao: new Date(dataEmissao),
        operacao,
        cliente,
        itemId,
        valor,
        status: status ?? "PENDENTE",
      },
    });

    return orcamento;
  }
}

export { CreateOrcamentoService };
