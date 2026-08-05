import prisma from '../prisma'; 

export class SequenceService {
  private static async getNextSequence(name: string): Promise<number> {
    const sequence = await prisma.sequence.upsert({
      where: { name },
      update: { value: { increment: 1 } },
      create: { name, value: 1 },
    });

    return sequence.value;
  }

  static async getNextOrcamentoNumber(): Promise<number> {
    return this.getNextSequence('orcamento');
  }
}
