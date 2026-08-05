import { PrismaClient } from '../generated/prisma';

export class DatabaseBackupService {
  private prisma = new PrismaClient();

  async exportAllData() {
    const [
      customers,
      categories,
      items,
      item_files,
      pedidos,
      orcamentos,
      historico,
      orcamento_pdfs,
      sequences
    ] = await Promise.all([
      this.prisma.customer.findMany(),
      this.prisma.category.findMany(),
      this.prisma.item.findMany(),
      this.prisma.itemFile.findMany(),
      this.prisma.pedido.findMany(),
      this.prisma.orcamento.findMany(),
      this.prisma.historico.findMany(),
      this.prisma.orcamentoPdf.findMany(),
      this.prisma.sequence.findMany()
    ]);

    return {
      customers,
      categories,
      items,
      item_files,
      pedidos,
      orcamentos,
      historico,
      orcamento_pdfs,
      sequences,
      exportedAt: new Date()
    };
  }

  async exportTableData(tableName: string) {
    switch (tableName) {
      case 'customers':
        return this.prisma.customer.findMany();
      case 'categories':
        return this.prisma.category.findMany();
      case 'items':
        return this.prisma.item.findMany();
      case 'item_files':
        return this.prisma.itemFile.findMany();
      case 'pedidos':
        return this.prisma.pedido.findMany();
      case 'orcamentos':
        return this.prisma.orcamento.findMany();
      case 'historico':
        return this.prisma.historico.findMany();
      case 'orcamento_pdfs':
        return this.prisma.orcamentoPdf.findMany();
      case 'sequences':
        return this.prisma.sequence.findMany();
      default:
        throw new Error(`Table ${tableName} not found`);
    }
  }
}