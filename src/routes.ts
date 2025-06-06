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
const pedidoController = new PedidoController();


export async function routes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Rota de teste simples
  fastify.get("/teste", async (request: FastifyRequest, reply: FastifyReply) => {
    return { ok: true };
  });





  // Criar novo cliente
  fastify.post("/customer", async (request, reply) => {
    console.log("Recebido no /customer:", request.body);
    return new CreateCustomer().handle(request, reply);
  });

  // Listar todos os clientes
  fastify.get("/customers", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const customers = await prisma.customer.findMany();
      // Retorna no formato esperado pelo frontend, com chave 'clientes'
      return reply.send({ clientes: customers });
    } catch (error) {
      return reply.status(500).send({ error: "Erro ao buscar clientes" });
    }
  });


  // Deletar cliente por ID
  fastify.delete("/customer/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    return new DeleteCustomer().handle(request, reply);
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

  fastify.post("/categories", async (request, reply) => {
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

        // Guardar só o nome do arquivo, para servir pela URL
        imagePath = fileName;
      } else if (part.type === 'field' && part.fieldname === 'name') {
        name = part.value as string;
      }
    }

    if (!name || !imagePath) {
      return reply.status(400).send({ error: 'Nome ou imagem não fornecidos.' });
    }

    return createCategory(
      {
        ...request,
        body: { name, imagePath }
      },
      reply
    );
  });



  fastify.get("/categories/:id/items", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.query as { status?: string };

    try {
      const whereClause = {
        categoryId: id,
        ...(status && { status }) // Filtro opcional por status
      };

      const items = await prisma.item.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc'
        }
      });

      return reply.send(items);
    } catch (err) {
      return reply.status(500).send({ message: "Erro ao buscar itens", error: err });
    }
  });


  fastify.post("/items", async (request, reply) => {
    const parts = request.parts();

    let name = '';
    let subname = '';
    let categoryId = '';
    let imagePath = '';
    let filePath = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const uploadsDir = path.join(__dirname, '..', 'uploads');

        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${part.filename}`;
        const fileDest = path.join(uploadsDir, fileName);
        await pump(part.file, fs.createWriteStream(fileDest));

        if (part.fieldname === 'image') {
          imagePath = fileName;
        } else if (part.fieldname === 'file') {
          filePath = fileName;
        }
      } else if (part.type === 'field') {
        if (part.fieldname === 'name' && typeof part.value === 'string') {
          name = part.value;
        }
        if (part.fieldname === 'subname' && typeof part.value === 'string') {
          subname = part.value;
        }
        if (part.fieldname === 'categoryId' && typeof part.value === 'string') {
          categoryId = part.value;
        }
      }
    }

    if (!name || !subname || !imagePath || !filePath || !categoryId) {
      return reply.status(400).send({ error: "Todos os campos são obrigatórios" });
    }

    const newItem = await prisma.item.create({
      data: {
        name,
        subname,
        imagePath,
        filePath,
        categoryId,
        status: "PENDENTE" // Valor padrão
      },
    });

    return reply.status(201).send(newItem);
  });





  fastify.patch("/items/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    if (!["PENDENTE", "CONCLUIDO"].includes(status)) {
      return reply.status(400).send({ error: "Status inválido" });
    }

    try {
      const updatedItem = await prisma.item.update({
        where: { id },
        data: { status },
      });
      return reply.send(updatedItem);
    } catch (err) {
      return reply.status(404).send({ error: "Item não encontrado" });
    }
  });


  fastify.put("/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parts = request.parts();

    let updateData: any = {};
    let imagePath: string | null = null;
    let filePath: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        const uploadsDir = path.join(__dirname, '..', 'uploads');

        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${part.filename}`;
        const fileDest = path.join(uploadsDir, fileName);
        await pump(part.file, fs.createWriteStream(fileDest));

        if (part.fieldname === 'image') {
          imagePath = fileName;
        } else if (part.fieldname === 'file') {
          filePath = fileName;
        }
      } else if (part.type === 'field') {
        if (part.fieldname === 'name' && typeof part.value === 'string') {
          updateData.name = part.value;
        }
        if (part.fieldname === 'subname' && typeof part.value === 'string') {
          updateData.subname = part.value;
        }
        if (part.fieldname === 'status' && typeof part.value === 'string') {
          updateData.status = part.value;
        }
      }
    }

    if (imagePath) updateData.imagePath = imagePath;
    if (filePath) updateData.filePath = filePath;

    try {
      const updatedItem = await prisma.item.update({
        where: { id },
        data: updateData,
      });

      return reply.send(updatedItem);
    } catch (err) {
      return reply.status(404).send({ error: "Item não encontrado" });
    }
  });

  // Adicione esta rota no seu arquivo de rotas, junto com as outras rotas de items
  fastify.get("/items", async (request: FastifyRequest, reply: FastifyReply) => {
    const { status, sort, limit } = request.query as {
      status?: 'PENDENTE' | 'CONCLUIDO';
      sort?: string;
      limit?: string;
    };

    try {
      // Define valores padrão
      let orderBy: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };

      if (sort) {
        const [field, direction] = sort.split(':');
        // Só aceita 'asc' ou 'desc' como direção, senão usa 'asc' por padrão
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




  fastify.post("/pedidos", async (request, reply) => {
    const {
      itemId,
      cliente,  // agora é string
      quantidade,
      material,
      dataEmissao,
      operacao,
      status,
    } = request.body as {
      itemId: string;
      cliente: string;  // string simples
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
          cliente,  // string simples aqui
          quantidade,
          material,
          dataEmissao: new Date(dataEmissao),
          operacao,
          status,
        },
      });

      return reply.status(201).send(novoPedido);
    } catch (err) {
      return reply.status(400).send({ error: "Erro ao criar pedido", detail: err });
    }
  });


  fastify.get("/pedidos", async (request, reply) => {
    try {
      const pedidos = await prisma.pedido.findMany({
        include: {
          item: true, // apenas o item é relacional
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
    // Primeiro verifique se há itens pendentes
    const itemsCount = await prisma.item.count({
      where: { status: 'PENDENTE' }
    });

    if (itemsCount === 0) {
      return reply.send([]);
    }

    // Busque os itens com pedidos relacionados
    const items = await prisma.item.findMany({
      where: { 
        status: 'PENDENTE',
        pedidos: {
          some: {} // Garante que só retorne itens com pelo menos um pedido
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { 
        pedidos: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1 // Pega apenas o pedido mais recente
        }
      }
    });

    // Formate os dados para evitar problemas de serialização
    const formattedItems = items.map(item => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      pedidos: item.pedidos.map(pedido => ({
        ...pedido,
        dataEmissao: pedido.dataEmissao.toISOString(),
        createdAt: pedido.createdAt.toISOString()
      }))
    }));

    return reply.send(formattedItems);

  } catch (error) {
    console.error('Erro detalhado ao buscar itens pendentes:', {
      message: error.message,
      stack: error.stack,
      prismaError: error.meta || error.code
    });
    
    return reply.status(500).send({
      error: "Erro ao buscar itens pendentes",
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});





  fastify.patch("/pedidos/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    if (!["EM_ANDAMENTO", "FINALIZADO", "CANCELADO"].includes(status)) {
      return reply.status(400).send({ error: "Status inválido" });
    }

    try {
      const pedidoAtualizado = await prisma.pedido.update({
        where: { id },
        data: { status },
      });
      return reply.send(pedidoAtualizado);
    } catch (err) {
      return reply.status(404).send({ error: "Pedido não encontrado" });
    }
  });

  fastify.delete("/pedidos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.pedido.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(404).send({ error: "Pedido não encontrado" });
    }
  });



  fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads', // Ex: http://localhost:3333/uploads/image.jpg
  });

  // Adicione esta rota para atualizar categorias
  fastify.put("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parts = request.parts();

    let updateData: any = {};
    let imagePath: string | null = null;

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

      return reply.send(updatedCategory);
    } catch (err) {
      return reply.status(404).send({ error: "Categoria não encontrada" });
    }
  });

  // Rota para deletar categoria
  fastify.delete("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      // Verifique se a categoria existe
      const category = await prisma.category.findUnique({
        where: { id },
        include: { items: true } // Verifique se há itens associados
      });

      if (!category) {
        return reply.status(404).send({ error: "Categoria não encontrada" });
      }

      if (category.items.length > 0) {
        return reply.status(400).send({
          error: "Não é possível excluir categoria com itens associados"
        });
      }

      // Se tudo ok, deleta a categoria
      await prisma.category.delete({
        where: { id }
      });

      return reply.send({ success: true });
    } catch (err) {
      console.error("Erro ao deletar categoria:", err);
      return reply.status(500).send({ error: "Erro interno ao deletar categoria" });
    }
  });



  // Rota para deletar item
  fastify.delete("/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.item.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(404).send({ error: "Item não encontrado" });
    }
  });


  fastify.post("/orcamentos", {}, async (request, reply) => {
    const controller = new CreateOrcamentoController();
    return controller.handle(request, reply);
  });



  fastify.get("/orcamentos", async (request, reply) => {
  try {
    // Primeiro verifique quais status existem no banco
    const statusExistentes = await prisma.orcamento.groupBy({
      by: ['status'],
      _count: { status: true }
    });
    console.log('Status encontrados:', statusExistentes);

    // Busque os orçamentos com tratamento seguro para status
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

    // Normalize os status e filtre valores inválidos
    const orcamentosFormatados = orcamentos.map(o => {
      // Normaliza o status para uppercase e substitui espaços por underscore
      let statusNormalizado = o.status
        ? o.status.toString().toUpperCase().replace(/\s+/g, '_')
        : 'PENDENTE';
      
      // Lista de status válidos conforme o enum no schema
      const statusValidos = ['PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO', 'CONVERTIDO'];
      
      // Se o status não for válido, define como PENDENTE
      if (!statusValidos.includes(statusNormalizado)) {
        statusNormalizado = 'PENDENTE';
      }

      return {
        ...o,
        status: statusNormalizado,
        cliente: o.cliente || "Cliente não especificado",
        // Garante que o valor seja um número (evita problemas com Decimal do Prisma)
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
      // Mostra detalhes apenas em desenvolvimento
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        meta: error.meta
      } : null
    });
  }
});




  fastify.post("/orcamentos/:id/transformar-em-pedido", async (request, reply) => {
    const { id } = request.params;

    try {


      // 1. Buscar o orçamento
      const orcamento = await prisma.orcamento.findUnique({
        where: { id },
        include: { item: true }
      });

      if (!orcamento) {
        return reply.status(404).send({ error: "Orçamento não encontrado" });
      }

      // Normalize o status se necessário
      if (orcamento.status) {
        orcamento.status = orcamento.status.toUpperCase().replace(' ', '_');
      }

      if (!orcamento) {
        return reply.status(404).send({ error: "Orçamento não encontrado" });
      }

      // 2. Verificar se já existe pedido ativo para o item
      const pedidoExistente = await prisma.pedido.findFirst({
        where: {
          itemId: orcamento.itemId,
          status: { notIn: ["CANCELADO", "FINALIZADO"] }
        }
      });

      if (pedidoExistente) {
        return reply.status(400).send({
          error: "Já existe um pedido ativo para este item",
          pedidoId: pedidoExistente.id,
          status: pedidoExistente.status
        });
      }

      // 3. Criar novo pedido
      const pedido = await prisma.pedido.create({
        data: {
          quantidade: orcamento.quantidade,
          material: orcamento.material,
          dataEmissao: orcamento.dataEmissao,
          operacao: orcamento.operacao,
          cliente: orcamento.cliente || "Cliente não especificado",
          itemId: orcamento.itemId,
          status: "PENDENTE"
        }
      });



      // 4. Atualizar orçamento
      await prisma.orcamento.update({
        where: { id },
        data: {
          status: "CONVERTIDO"
        }
      });

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




}