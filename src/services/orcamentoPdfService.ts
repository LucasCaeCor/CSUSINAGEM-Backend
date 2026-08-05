// src/services/orcamentoPdf.service.ts
import prisma from '../prisma';
import { SequenceService } from './sequence.service';


export const orcamentoPdfService = {
  async listAll() {
    return await prisma.orcamentoPdf.findMany({
      orderBy: {
        numero: 'desc'
      }
    });
  },

  async findById(id: string) {
    return await prisma.orcamentoPdf.findUnique({
      where: { id }
    });
  },

  async create(data: any) {
    const nextNumber = await SequenceService.getNextOrcamentoNumber();
    return await prisma.orcamentoPdf.create({
      data: {
        ...data,
        numero: nextNumber,
      }
    });
  },

  async update(id: string, data: any) {
    return await prisma.orcamentoPdf.update({
      where: { id },
      data
    });
  }
};