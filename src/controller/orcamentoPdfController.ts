// src/controllers/orcamentoPdf.controller.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { generatePdf } from '../services/pdfService';
import path from 'path';
import fs from 'fs';

import { orcamentoPdfService } from '../services/orcamentoPdfService';

export class OrcamentoPdfController {
  async getPdf(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };

      const orcamento = await orcamentoPdfService.findById(id);

      if (!orcamento || !orcamento.pdfPath) {
        return reply.status(404).send({ error: "PDF não encontrado" });
      }

      const filePath = path.join(__dirname, '..', '..', 'uploads', 'orcamentos', orcamento.pdfPath);

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: "Arquivo PDF não encontrado no servidor" });
      }

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="orcamento_${orcamento.numero}.pdf"`)
        .send(fs.createReadStream(filePath));
    } catch (error) {
      console.error("Erro ao buscar PDF:", error);
      return reply.status(500).send({
        error: "Erro interno ao buscar PDF",
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    try {
      const orcamentos = await orcamentoPdfService.listAll();
      reply.send(orcamentos);
    } catch (error) {
      console.error("Erro ao listar orçamentos:", error);
      reply.status(500).send({
        error: 'Erro interno ao listar orçamentos',
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any;

      // Validação da data
      let dataOrcamento: Date;
      try {
        const dateStr = body.data.includes('/') 
          ? body.data.split('/').reverse().join('-')
          : body.data;
        
        dataOrcamento = new Date(dateStr);
        
        if (isNaN(dataOrcamento.getTime())) {
          throw new Error('Data inválida');
        }
      } catch (error) {
        return reply.status(400).send({
          error: "Data inválida",
          details: "Formato esperado: DD/MM/YYYY ou YYYY-MM-DD"
        });
      }

      if (!body.cliente || !body.items || !Array.isArray(body.items)) {
        return reply.status(400).send({ error: "Dados inválidos" });
      }

      // Cálculo do valor total
      const valorTotal = body.items.reduce((sum: number, item: any) => {
        return sum + (item.quantidade * item.valorUnitario);
      }, 0);

      // Criação do registro - NÃO enviamos mais o número
      const orcamento = await orcamentoPdfService.create({
        data: dataOrcamento,
        cliente: body.cliente,
        cnpj: body.cnpj, // Novo campo CNPJ
        prazoEntrega: body.prazoEntrega,
        frete: body.frete,
        condPagamento: body.condPagamento,
        items: body.items,
        cfop: body.cfop,
        valorIcms: body.valorIcms,
        valorIpi: body.valorIpi,
        valorIss: body.valorIss,
        observacao: body.observacao,
        valorTotal,
      });


      // Resto do código permanece igual...
      const pdfBuffer = await generatePdf(orcamento);

      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'orcamentos');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const pdfFileName = `orcamento_${orcamento.numero}.pdf`;
      const pdfPath = path.join(uploadsDir, pdfFileName);
      fs.writeFileSync(pdfPath, pdfBuffer);

      const updatedOrcamento = await orcamentoPdfService.update(orcamento.id, {
        pdfPath: pdfFileName
      });

      return reply.status(201).send(updatedOrcamento);
    } catch (error) {
      console.error("Erro ao criar orçamento:", error);
      return reply.status(500).send({
        error: "Erro ao criar orçamento",
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
}

  async update(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const updatedOrcamento = await orcamentoPdfService.update(id, body);

      return reply.send(updatedOrcamento);
    } catch (error) {
      console.error("Erro ao atualizar orçamento:", error);
      return reply.status(500).send({
        error: "Erro ao atualizar orçamento",
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
  }
}