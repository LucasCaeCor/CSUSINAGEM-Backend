import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { ListCustomer } from "./controller/listCustomerController";
import { CreateCustomer } from "./controller/createCustomerController";
import { DeleteCustomer } from "./controller/deleteCustomerController";
import { AuthService } from "./services/authService";
import { createCategory, getCategories, getCategoryById } from "./controller/categoryController";
import { pipeline } from 'stream';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import { promisify } from 'util';
import path from "path";
import prisma from "./prisma";
import { PedidoController } from "./controller/pedidoController";
import { CreateOrcamentoController } from "./controller/createOrcamentoController";
import { HistoryService } from "./services/historyService";
import { StatusPedido } from "./generated/prisma";

const pedidoController = new PedidoController();

interface FastifyRequestWithUser extends FastifyRequest {
  user?: {
    id: string;
    name: string;
    email: string;
    
  };
}

export async function routes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Middleware para adicionar usuário ao request
  fastify.addHook("onRequest", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    try {
      const token = request.headers.authorization?.split(' ')[1];
      if (token) {
        const authService = new AuthService();
        const decoded = authService.verifyToken(token);
        request.user = {
          id: decoded.id,
          name: decoded.name,
          email: decoded.email
        };
      }
    } catch (error) {
      // Não falhar se não houver token ou for inválido
    }
  });

  // Rota de teste simples
  fastify.get("/teste", async (request: FastifyRequest, reply: FastifyReply) => {
    return { ok: true };
  });

  // Criar novo cliente
  fastify.post("/customer", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    console.log("Recebido no /customer:", request.body);
    const result = await new CreateCustomer().handle(request, reply);

    if (result && !reply.sent) {
      await HistoryService.registrar(
        'CRIAR',
        'CLIENTE',
        result.id,
        request,
        null,
        result
      );
    }

    return result;
  });

  // Listar todos os clientes
  fastify.get("/customers", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const customers = await prisma.customer.findMany();
      return reply.send({ clientes: customers });
    } catch (error) {
      return reply.status(500).send({ error: "Erro ao buscar clientes" });
    }
  });

  // Deletar cliente por ID
  fastify.delete("/customer/:id", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const cliente = await prisma.customer.findUnique({
      where: { id: request.params.id }
    });

    const result = await new DeleteCustomer().handle(request, reply);

    if (result && !reply.sent) {
      await HistoryService.registrar(
        'DELETAR',
        'CLIENTE',
        request.params.id,
        request,
        cliente,
        null
      );
    }

    return result;
  });

  // Login (autenticação)
  fastify.post("/login", async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    try {
      const authService = new AuthService();
      const result = await authService.authenticate({ email, password });
      return reply.send({ success: true, token: result.token, name: result.name });
    } catch (err: any) {
      return reply.status(401).send({ success: false, message: err.message });
    }
  });

  // GET categorias
  fastify.get("/categories", async (request, reply) => {
    return getCategories(request, reply);
  });

  fastify.get("/categories/:id", async (request, reply) => {
    return getCategoryById(request, reply);
  });

  const pump = promisify(pipeline);

  fastify.post("/categories", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const parts = request.parts();

    let name = '';
    let imagePath = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const uploadsDir = path.join(__dirname, '..', 'uploads');

        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${part.filename}`;
        const filePath = path.join(uploadsDir, fileName);
        await pump(part.file, fs.createWriteStream(filePath));

        imagePath = fileName;
      } else if (part.type === 'field' && part.fieldname === 'name') {
        name = part.value as string;
      }
    }

    if (!name || !imagePath) {
      return reply.status(400).send({ error: 'Nome ou imagem não fornecidos.' });
    }

    const newCategory = await prisma.category.create({
      data: { name, imagePath }
    });

    await HistoryService.registrar(
      'CRIAR',
      'CATEGORIA',
      newCategory.id,
      request,
      null,
      newCategory
    );

    return reply.send(newCategory);
  });

  fastify.get("/categories/:id/items", async (request, reply) => {
  const { id } = request.params as { id: string };
  const { status } = request.query as { status?: string };

  try {
    const whereClause = {
      categoryId: id,
      ...(status && { status })
    };

    const items = await prisma.item.findMany({
      where: whereClause,
      include: {
        files: true // Garante que os arquivos sejam incluídos
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Garante que cada item tenha files mesmo que vazio
    const itemsWithFiles = items.map(item => ({
      ...item,
      files: item.files || []
    }));

    return reply.send(itemsWithFiles);
  } catch (err) {
    return reply.status(500).send({ message: "Erro ao buscar itens", error: err });
  }
});

  fastify.post("/items", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const parts = request.parts();

    let name = '';
    let subname = '';
    let categoryId = '';
    const dwgFiles: string[] = [];
    const pdfFiles: string[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const uploadsDir = path.join(__dirname, '..', 'uploads');

        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${part.filename}`;
        const fileDest = path.join(uploadsDir, fileName);
        await pump(part.file, fs.createWriteStream(fileDest));

        if (part.fieldname === 'dwgFiles') {
          dwgFiles.push(fileName);
        } else if (part.fieldname === 'pdfFiles') {
          pdfFiles.push(fileName);
        }
      } else if (part.type === 'field') {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'subname') subname = part.value as string;
        if (part.fieldname === 'categoryId') categoryId = part.value as string;
      }
    }

    // Validações
    if (!name || !subname || !categoryId) {
      return reply.status(400).send({ error: "Nome, subnome e categoria são obrigatórios" });
    }

    if (dwgFiles.length === 0 && pdfFiles.length === 0) {
      return reply.status(400).send({ error: "Pelo menos um arquivo deve ser enviado" });
    }

    try {
      // Cria o item
      const newItem = await prisma.item.create({
        data: {
          name,
          subname,
          categoryId,
          status: "PENDENTE",
          files: {
            create: [
              ...dwgFiles.map(path => ({
                path,
                type: path.endsWith('.dwg') ? 'DWG' : 'IMAGE'
              })),
              ...pdfFiles.map(path => ({
                path,
                type: 'PDF'
              }))
            ]
          }
        },
        include: {
          files: true
        }
      });

      await HistoryService.registrar(
        'CRIAR',
        'ITEM',
        newItem.id,
        request,
        null,
        newItem
      );

      return reply.status(201).send(newItem);
    } catch (err) {
      console.error("Erro ao criar item:", err);
      return reply.status(500).send({ error: "Erro interno ao criar item" });
    }
  });



  fastify.patch('/items/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDO']
          }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    try {
      const updatedItem = await prisma.item.update({
        where: { id },
        data: { status },
        include: { pedidos: true }
      });

      // Atualizar status do pedido relacionado se existir
      if (updatedItem.pedidos && updatedItem.pedidos.length > 0) {
        await prisma.pedido.update({
          where: { id: updatedItem.pedidos[0].id },
          data: { status }
        });
      }

      return reply.send(updatedItem);
    } catch (error) {
      console.error("Erro ao atualizar item:", error);
      return reply.status(500).send({ error: "Erro interno no servidor" });
    }
  });

  fastify.put("/items/:id", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params;
    const parts = request.parts();

    let updateData: any = {};
    const newPdfFiles: string[] = [];
    const newDwgFiles: string[] = [];
    const keepFiles: string[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${part.filename}`;
        const fileDest = path.join(uploadsDir, fileName);
        await pump(part.file, fs.createWriteStream(fileDest));

        if (part.fieldname === 'newPdfFiles') {
          newPdfFiles.push(fileName);
        } else if (part.fieldname === 'newDwgFiles') {
          newDwgFiles.push(fileName);
        }
      } else if (part.type === 'field') {
        if (part.fieldname === 'name') updateData.name = part.value;
        if (part.fieldname === 'subname') updateData.subname = part.value;
        if (part.fieldname === 'status') updateData.status = part.value;
        if (part.fieldname === 'keepFiles') keepFiles.push(part.value);
      }
    }

    try {
      // 1. Remove arquivos não selecionados
      await prisma.itemFile.deleteMany({
        where: {
          itemId: id,
          NOT: { id: { in: keepFiles } }
        }
      });

      // 2. Adiciona novos arquivos
      const newFiles = [
        ...newPdfFiles.map(path => ({ path, type: 'PDF' })),
        ...newDwgFiles.map(path => ({
          path,
          type: path.endsWith('.dwg') ? 'DWG' : 'IMAGE'
        }))
      ];

      if (newFiles.length > 0) {
        await prisma.item.update({
          where: { id },
          data: {
            files: {
              create: newFiles
            }
          }
        });
      }

      // 3. Atualiza outros dados do item
      const updatedItem = await prisma.item.update({
        where: { id },
        data: updateData,
        include: { files: true }
      });

      return reply.send(updatedItem);
    } catch (err) {
      console.error("Erro ao atualizar item:", err);
      return reply.status(500).send({ error: "Erro interno ao atualizar item" });
    }
  });

  fastify.get("/items", async (request: FastifyRequest, reply: FastifyReply) => {
    const { status, sort, limit } = request.query as {
      status?: 'PENDENTE' | 'CONCLUIDO';
      sort?: string;
      limit?: string;
    };

    try {
      let orderBy: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };

      if (sort) {
        const [field, direction] = sort.split(':');
        if (field && (direction === 'asc' || direction === 'desc')) {
          orderBy = { [field]: direction };
        }
      }

      const take = limit ? parseInt(limit) : undefined;

      const items = await prisma.item.findMany({
        where: status ? { status } : {},
        orderBy,
        take,
      });

      return reply.send(items);
    } catch (err) {
      console.error("Erro ao buscar itens:", err);
      return reply.status(500).send({ error: "Erro interno ao buscar itens" });
    }
  });

  fastify.post("/pedidos", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const {
      itemId,
      cliente,
      quantidade,
      material,
      dataEmissao,
      operacao,
      status,
    } = request.body as {
      itemId: string;
      cliente: string;
      quantidade: number;
      material: string;
      dataEmissao: string;
      operacao: string;
      status?: string;
    };

    if (!itemId || !cliente || !quantidade || !material || !dataEmissao || !operacao) {
      return reply.status(400).send({ error: 'Campos obrigatórios faltando.' });
    }

    try {
      const novoPedido = await prisma.pedido.create({
        data: {
          itemId,
          cliente,
          quantidade,
          material,
          dataEmissao: new Date(dataEmissao),
          operacao,
          status,
        },
      });

      await HistoryService.registrar(
        'CRIAR',
        'PEDIDO',
        novoPedido.id,
        request,
        null,
        novoPedido
      );

      return reply.status(201).send(novoPedido);
    } catch (err) {
      return reply.status(400).send({ error: "Erro ao criar pedido", detail: err });
    }
  });

  fastify.get("/pedidos", async (request, reply) => {
    try {
      const pedidos = await prisma.pedido.findMany({
        include: {
          item: true,
        },
        orderBy: {
          createdAt: 'desc',
        }
      });

      return reply.send(pedidos);
    } catch (err) {
      console.error("Erro ao buscar pedidos:", err);
      return reply.status(500).send({ error: "Erro ao buscar pedidos" });
    }
  });

  fastify.get('/items/pending-with-pedido', async (request, reply) => {
  try {
    const items = await prisma.item.findMany({
      where: {
        OR: [
          { status: 'PENDENTE' },
          { status: 'EM_ANDAMENTO' },
          { 
            pedidos: {
              some: {
                OR: [
                  { status: 'PENDENTE' },
                  { status: 'EM_ANDAMENTO' }
                ]
              }
            }
          }
        ]
      },
      include: {
        pedidos: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        category: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.send(items);
  } catch (error) {
    console.error('Erro ao buscar itens pendentes:', error);
    return reply.status(500).send({ error: 'Erro interno ao buscar itens' });
  }
});


  fastify.patch("/pedidos/:id/status", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    if (!["EM_ANDAMENTO", "CONCLUIDO", "CANCELADO"].includes(status)) {
      return reply.status(400).send({ error: "Status inválido" });
    }

    if (!Object.values(StatusPedido).includes(status as StatusPedido)) {
      return reply.status(400).send({ error: "Status inválido" });
    }


    const pedidoAntes = await prisma.pedido.findUnique({ where: { id } });

    try {
      const pedidoAtualizado = await prisma.pedido.update({
        where: { id },
        data: { status },
      });

      await HistoryService.registrar(
        'STATUS_ALTERADO',
        'PEDIDO',
        id,
        request,
        { status: pedidoAntes?.status },
        { status: pedidoAtualizado.status }
      );

      return reply.send(pedidoAtualizado);
    } catch (err) {
      return reply.status(404).send({ error: "Pedido não encontrado" });
    }
  });


  fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads',
  });

  fastify.put("/categories/:id", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parts = request.parts();

    let updateData: any = {};
    let imagePath: string | null = null;

    const categoriaAntes = await prisma.category.findUnique({ where: { id } });

    for await (const part of parts) {
      if (part.type === 'file') {
        const uploadsDir = path.join(__dirname, '..', 'uploads');

        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${part.filename}`;
        const fileDest = path.join(uploadsDir, fileName);
        await pump(part.file, fs.createWriteStream(fileDest));

        imagePath = fileName;
      } else if (part.type === 'field') {
        if (part.fieldname === 'name' && typeof part.value === 'string') {
          updateData.name = part.value;
        }
      }
    }

    if (imagePath) updateData.imagePath = imagePath;

    try {
      const updatedCategory = await prisma.category.update({
        where: { id },
        data: updateData,
      });

      await HistoryService.registrar(
        'ATUALIZAR',
        'CATEGORIA',
        id,
        request,
        categoriaAntes,
        updatedCategory
      );

      return reply.send(updatedCategory);
    } catch (err) {
      return reply.status(404).send({ error: "Categoria não encontrada" });
    }
  });

  fastify.delete("/categories/:id", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const category = await prisma.category.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!category) {
        return reply.status(404).send({ error: "Categoria não encontrada" });
      }

      if (category.items.length > 0) {
        return reply.status(400).send({
          error: "Não é possível excluir categoria com itens associados"
        });
      }

      await prisma.category.delete({
        where: { id }
      });

      await HistoryService.registrar(
        'DELETAR',
        'CATEGORIA',
        id,
        request,
        category,
        null
      );

      return reply.send({ success: true });
    } catch (err) {
      console.error("Erro ao deletar categoria:", err);
      return reply.status(500).send({ error: "Erro interno ao deletar categoria" });
    }
  });

  fastify.delete('/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      // 1. Buscar pedidos relacionados ao item
      const pedidos = await prisma.pedido.findMany({
        where: { itemId: id },
        select: { id: true }
      });

      const pedidoIds = pedidos.map(p => p.id);

      // 2. Apagar histórico relacionado a esses pedidos e ao item
      await prisma.historico.deleteMany({
        where: {
          OR: [
            { entidade: 'ITEM', entidadeId: id },
            { entidade: 'PEDIDO', entidadeId: { in: pedidoIds } }
          ]
        }
      });

      // 3. Apagar pedidos relacionados
      await prisma.pedido.deleteMany({
        where: { itemId: id }
      });

      // 4. Apagar o item
      await prisma.item.delete({
        where: { id }
      });

      return reply.send({ success: true });
    } catch (error) {
      console.error("Erro ao excluir item e limpar histórico:", error);
      return reply.status(400).send({ error: "Erro ao excluir item" });
    }
  });



  fastify.post("/orcamentos", {}, async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const controller = new CreateOrcamentoController();
    const result = await controller.handle(request, reply);

    if (result && !reply.sent) {
      await HistoryService.registrar(
        'CRIAR',
        'ORCAMENTO',
        result.id,
        request,
        null,
        result
      );
    }

    return result;
  });

  fastify.get("/orcamentos", async (request, reply) => {
    try {
      const statusExistentes = await prisma.orcamento.groupBy({
        by: ['status'],
        _count: { status: true }
      });
      console.log('Status encontrados:', statusExistentes);

      const orcamentos = await prisma.orcamento.findMany({
        include: {
          item: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const orcamentosFormatados = orcamentos.map(o => {
        let statusNormalizado = o.status
          ? o.status.toString().toUpperCase().replace(/\s+/g, '_')
          : 'PENDENTE';

        const statusValidos = ['PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO', 'EM_ANDAMENTO'];

        if (!statusValidos.includes(statusNormalizado)) {
          statusNormalizado = 'PENDENTE';
        }

        return {
          ...o,
          status: statusNormalizado,
          cliente: o.cliente || "Cliente não especificado",
          valor: Number(o.valor)
        };
      });

      return reply.send(orcamentosFormatados);
    } catch (error) {
      console.error("Erro detalhado ao buscar orçamentos:", {
        message: error.message,
        stack: error.stack,
        prismaError: error.meta || error.code
      });

      return reply.status(500).send({
        error: "Erro ao buscar orçamentos",
        details: process.env.NODE_ENV === 'development' ? {
          message: error.message,
          code: error.code,
          meta: error.meta
        } : null
      });
    }
  });

  fastify.post("/orcamentos/:id/transformar-em-pedido", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const orcamento = await prisma.orcamento.findUnique({
        where: { id },
        include: { item: true }
      });

      if (!orcamento) {
        return reply.status(404).send({ error: "Orçamento não encontrado" });
      }

      // Verifica se já existe um pedido ativo para este item
      const pedidoExistente = await prisma.pedido.findFirst({
        where: {
          itemId: orcamento.itemId,
          status: { notIn: ["CANCELADO", "CONCLUIDO"] } // Considera apenas pedidos não finalizados
        }
      });

      if (pedidoExistente) {
        return reply.status(400).send({
          error: "Já existe um pedido ativo para este item",
          pedidoId: pedidoExistente.id,
          status: pedidoExistente.status
        });
      }

      // Cria o novo pedido
      const pedido = await prisma.pedido.create({
        data: {
          quantidade: orcamento.quantidade,
          material: orcamento.material,
          dataEmissao: orcamento.dataEmissao,
          operacao: orcamento.operacao,
          cliente: orcamento.cliente || "Cliente não especificado",
          itemId: orcamento.itemId,
          status: "EM_ANDAMENTO" // Status inicial
        }
      });

      // Atualiza o status do orçamento
      const orcamentoAtualizado = await prisma.orcamento.update({
        where: { id },
        data: { status: "EM_ANDAMENTO" }
      });

      // Registra no histórico
      await HistoryService.registrar(
        'CONVERTER_ORCAMENTO',
        'ORCAMENTO',
        id,
        request,
        orcamento,
        orcamentoAtualizado
      );

      await HistoryService.registrar(
        'CRIAR',
        'PEDIDO',
        pedido.id,
        request,
        null,
        pedido
      );

      return reply.status(201).send(pedido);
    } catch (error) {
      console.error("Erro ao converter orçamento:", {
        message: error.message,
        code: error.code,
        meta: error.meta
      });

      return reply.status(500).send({
        error: "Erro interno no servidor",
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
  });

  // Rota para buscar pedido por orcamentoId
  fastify.get("/pedido/por-orcamento/:orcamentoId", async (request: FastifyRequest, reply: FastifyReply) => {
    const { orcamentoId } = request.params as { orcamentoId: string };

    try {
      const pedido = await prisma.pedido.findFirst({
        where: {
          item: {
            orcamentos: {
              some: { id: orcamentoId }
            }
          }
        },
        include: {
          item: true
        }
      });

      if (!pedido) {
        return reply.status(404).send({ error: "Pedido não encontrado para este orçamento" });
      }

      return reply.send(pedido);
    } catch (error) {
      console.error("Erro ao buscar pedido por orcamentoId:", error);
      return reply.status(500).send({ error: "Erro interno ao buscar pedido" });
    }
  });


  fastify.put("/orcamentos/:id", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const dadosAtualizacao = request.body as Partial<{
      cliente: string;
      quantidade: number;
      valor: number;
      status: string;
      material: string;
      operacao: string;
      dataEmissao: Date | string;
      itemId: string;
    }>;

    try {
      // Busca o orçamento atual antes de atualizar
      const orcamentoAntes = await prisma.orcamento.findUnique({ where: { id } });
      if (!orcamentoAntes) {
        return reply.status(404).send({ error: "Orçamento não encontrado" });
      }

      // Atualiza o orçamento com os dados recebidos
      const orcamentoAtualizado = await prisma.orcamento.update({
        where: { id },
        data: dadosAtualizacao,
      });

      // Registra a atualização no histórico
      await HistoryService.registrar(
        'ATUALIZAR',
        'ORCAMENTO',
        id,
        request,
        orcamentoAntes,
        orcamentoAtualizado
      );

      return reply.send(orcamentoAtualizado);
    } catch (error) {
      console.error("Erro ao atualizar orçamento:", error);
      return reply.status(500).send({ error: "Erro ao atualizar orçamento" });
    }
  });


  // Rotas de histórico
  fastify.get("/historico", async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      entidade,
      entidadeId,
      acao,
      pagina = 1,
      porPagina = 20
    } = request.query as {
      entidade?: string;
      entidadeId?: string;
      acao?: string;
      pagina?: string | number;
      porPagina?: string | number;
    };

    const paginaNum = Number(pagina);
    const porPaginaNum = Number(porPagina);

    try {
      const where: any = {};

      if (entidade) where.entidade = entidade.toUpperCase();
      if (entidadeId) where.entidadeId = entidadeId;
      if (acao) where.acao = { contains: acao.toUpperCase() };

      const [historico, total] = await Promise.all([
        prisma.historico.findMany({
          where,
          skip: (paginaNum - 1) * porPaginaNum,
          take: porPaginaNum,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.historico.count({ where })
      ]);


      return reply.send({
        dados: historico,
        paginacao: {
          pagina: paginaNum,
          porPagina: porPaginaNum,
          total,
          totalPaginas: Math.ceil(total / porPaginaNum)
        }
      });

    } catch (error) {
      console.error("Erro ao buscar histórico:", error);
      return reply.status(500).send({ error: "Erro ao buscar histórico" });
    }
  });

  fastify.get("/historico/:entidade/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { entidade, id } = request.params as {
      entidade: string;
      id: string;
    };

    try {


      const historico = await prisma.historico.findMany({
        where: {
          entidade: entidade.toUpperCase(),
          entidadeId: id
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      });

      return reply.send(historico);
    } catch (error) {
      console.error("Erro ao buscar histórico:", error);
      return reply.status(500).send({ error: "Erro ao buscar histórico" });
    }
  });

  // Rota para GET /item/:id
  fastify.get("/item/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const item = await prisma.item.findUnique({
        where: { id },
        include: {
          category: true,
          pedidos: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      if (!item) {
        return reply.status(404).send({ error: "Item não encontrado" });
      }

      return reply.send(item);
    } catch (error) {
      return reply.status(500).send({ error: "Erro ao buscar item" });
    }
  });

  // Rota para GET /pedido/:id
  fastify.get("/pedido/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const pedido = await prisma.pedido.findUnique({
        where: { id },
        include: {
          item: true
        }
      });

      if (!pedido) {
        return reply.status(404).send({ error: "Pedido não encontrado" });
      }

      return reply.send(pedido);
    } catch (error) {
      return reply.status(500).send({ error: "Erro ao buscar pedido" });
    }
  });
}