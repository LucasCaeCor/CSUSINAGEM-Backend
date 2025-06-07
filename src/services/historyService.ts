import prisma from "../prisma";
import { FastifyRequestWithUser } from "../types/fastify";

type AcaoHistorico = 
  | 'CRIAR' 
  | 'ATUALIZAR' 
  | 'DELETAR' 
  | 'STATUS_ALTERADO'
  | 'CONVERTER_ORCAMENTO';

type EntidadeHistorico =
  | 'ITEM'
  | 'PEDIDO'
  | 'ORCAMENTO'
  | 'CATEGORIA'
  | 'CLIENTE';

export class HistoryService {
  static async registrar(
    acao: AcaoHistorico,
    entidade: EntidadeHistorico,
    entidadeId: string,
    request: FastifyRequestWithUser,
    dadosAntigos?: any,
    dadosNovos?: any
  ) {
    try {
      let usuarioId: string | null = null;
      let usuarioNome: string | null = null;

      if (request.user) {
        usuarioId = request.user.id;
        usuarioNome = request.user.name;
      }

      await prisma.historico.create({
        data: {
          acao: `${acao}_${entidade}`,
          entidade,
          entidadeId,
          dados: JSON.stringify({
            antigos: dadosAntigos,
            novos: dadosNovos
          }),
          usuarioId,
          usuarioNome
        }
      });
    } catch (error) {
      console.error('Erro ao registrar histórico:', error);
    }
  }

  static async listarHistorico(entidade?: string, entidadeId?: string) {
    const where = {} as any;
    
    if (entidade) {
      where.entidade = entidade;
    }
    
    if (entidadeId) {
      where.entidadeId = entidadeId;
    }

    return prisma.historico.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      }
    });
  }
}