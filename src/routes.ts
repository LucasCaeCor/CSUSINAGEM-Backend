import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { ListCustomer } from "./controller/listCustomerController";


import { CreateCustomer } from "./controller/createCustomerController";
import { DeleteCustomer } from "./controller/deleteCustomerController";
// import { AuthService } from "./midlewares/authService";
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
import { OrcamentoPdfController } from './controller/orcamentoPdfController';
import { AuthService } from "./midlewares/authService";
import { BackupController } from "./controller/BackupController";
import GoogleDriveService from './services/googleDriveService';
import { google } from "googleapis";
import registerRestoreRoutes from "./routes/restore";


const orcamentoPdfController = new OrcamentoPdfController();
const backupController = new BackupController();

interface FastifyRequestWithUser extends FastifyRequest {
  user?: {
    id: string;
    name: string;
    email: string;
  };
}




export async function routes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Middleware para adicionar usuário ao request
  //  fastify.addHook("onRequest", async (request, reply) => {
  //   try {
  //     const token = request.headers.authorization?.split(' ')[1];
  //     if (!token) {
  //       return reply.status(401).send({ error: 'Authentication required' });
  //     }
  //     const authService = new AuthService();
  //     const decoded = authService.verifyToken(token);
  //     request.user = {
  //       id: decoded.id,
  //       name: decoded.name,
  //       email: decoded.email
  //     };
  //   } catch (error) {
  //     return reply.status(401).send({ error: 'Unauthorized' });
  //   }
  // });

  // fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
  //     try {
  //       const token = request.headers.authorization?.split(' ')[1];
  //       if (!token) {
  //         throw new Error('Authentication required');
  //       }

  //       const authService = new AuthService();
  //       const decoded = authService.verifyToken(token);

  //       (request as FastifyRequestWithUser).user = {
  //         id: decoded.id,
  //         name: decoded.name,
  //         email: decoded.email
  //       };
  //     } catch (error) {
  //       reply.status(401).send({ error: 'Unauthorized' });
  //     }
  //   });


  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = request.headers.authorization?.split(' ')[1];
      if (!token) {
        throw new Error('Authentication required');
      }
      const authService = new AuthService();
      const decoded = authService.verifyToken(token);
      (request as FastifyRequestWithUser).user = {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email
      };
    } catch (error) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });



  fastify.register(registerRestoreRoutes);


  fastify.get('/api/backups', async (request, reply) => {
    try {
      const driveService = GoogleDriveService.getInstance();
      console.log('Verificando credenciais...');
      await driveService.verifyCredentials();
      console.log('Listando backups...');
      const backups = await driveService.listBackups();
      if (!backups.success) {
        throw new Error(backups.error || 'Falha ao listar backups');
      }
      const mappedBackups = backups.data.map(file => ({
        id: file.id,
        name: file.name,
        createdTime: file.createdTime,
        size: file.size ? `${Math.round(Number(file.size) / 1024 / 1024)} MB` : '0 MB',
        type: driveService.determineBackupType(file.name),
        webViewLink: file.webViewLink
      }));
      console.log(`Retornando ${mappedBackups.length} backups`);
      return reply.send(mappedBackups);
    } catch (error) {
      console.error('Erro completo na rota /api/backups:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      return reply.status(500).send({
        error: 'Erro ao listar backups',
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
    }
  });


  // POST /api/backups - Criar backup
  fastify.post('/api/backups', async (request, reply) => {
    const { type } = request.body as { type: 'full' | 'database' | 'files' };

    if (type === 'full') {
      const result = await backupController.fullBackup(request, reply);
      return result;
    } else if (type === 'database') {
      const result = await backupController.tableBackup(request, reply);
      return result;
    } else if (type === 'files') {
      const result = await backupController.backupFiles(request, reply);
      return result;
    }
  });



  // DELETE /api/backups/:id - Excluir backup
  fastify.delete('/api/backups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = await GoogleDriveService.authorize();
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.delete({ fileId: id });

    return { success: true, message: 'Backup excluído com sucesso' };
  });

  fastify.post('/backup/full', backupController.fullBackup.bind(backupController));
  fastify.post('/backup/table/:table', backupController.tableBackup.bind(backupController));
  fastify.post('/backup/files', backupController.backupFiles.bind(backupController));
  fastify.get('/backup/list', async (request, reply) => {
    try {
      const backups = await GoogleDriveService.listBackups();
      return reply.send(backups);
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: 'Falha ao listar backups',
        error: error.message
      });
    }
  });


  fastify.get('/api/backup/auth', async (request, reply) => {
    GoogleDriveService.initialize();
    const authUrl = GoogleDriveService.generateAuthUrl();
    return reply.redirect(authUrl);
  });

  fastify.get('/api/backup/oauth', async (request, reply) => {
    const { code } = request.query as { code: string };
    try {
      await GoogleDriveService.getToken(code);
      return reply.send('Autenticação concluída!');
    } catch (error) {
      return reply.status(500).send('Falha na autenticação');
    }
  });

  fastify.get('/oauth2callback', async (request, reply) => {
    const { code } = request.query as { code: string };

    try {
      // Inicialize se ainda não foi feito
      if (!GoogleDriveService.oAuth2Client) {
        GoogleDriveService.initialize();
      }

      await GoogleDriveService.getToken(code);
      return reply.send('Autenticação com Google Drive concluída com sucesso!');
    } catch (error) {
      console.error('Erro na autenticação:', error);
      return reply.status(500).send('Falha na autenticação com Google Drive');
    }
  });

  fastify.get('/auth/google', async (request, reply) => {
    GoogleDriveService.initialize();
    const authUrl = GoogleDriveService.generateAuthUrl();
    return reply.redirect(authUrl);
  });
  // Rota para download de backup (opcional)
  fastify.get('/backup/download/:fileId', async (request, reply) => {
    const { fileId } = request.params as { fileId: string };

    try {
      const auth = await GoogleDriveService.authorize();
      const drive = google.drive({ version: 'v3', auth });

      const file = await drive.files.get({
        fileId,
        fields: 'name, mimeType'
      });

      reply.header('Content-Type', file.data.mimeType || 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${file.data.name}"`);

      const fileStream = await drive.files.get({
        fileId,
        alt: 'media'
      }, { responseType: 'stream' });

      return reply.send(fileStream.data);
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: 'Falha ao baixar backup',
        error: error.message
      });
    }
  });


  fastify.get("/orcamento-pdf", {
    // preHandler: [fastify.authenticate],
    handler: (request, reply) => orcamentoPdfController.list(request, reply)
  });


  // Orcamento PDF routes
  fastify.post("/orcamento-pdf", {
    // preHandler: [fastify.authenticate],
    handler: (request: FastifyRequest, reply: FastifyReply) =>
      orcamentoPdfController.create(request, reply)
  });




  fastify.get("/orcamento-pdf/:id/pdf", {
    // preHandler: [fastify.authenticate],
    handler: (request: FastifyRequest, reply: FastifyReply) =>
      orcamentoPdfController.getPdf(request, reply)
  });

  fastify.put("/orcamento-pdf/:id", {
    // preHandler: [fastify.authenticate],
    handler: (request: FastifyRequest, reply: FastifyReply) =>
      orcamentoPdfController.update(request, reply)
  });




  fastify.get("/orcamentos/:id/pdf", async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as { id: string };
  try {
    const orcamento = await prisma.orcamento.findUnique({
      where: { id },
      select: { pdfPath: true }
    });
    if (!orcamento || !orcamento.pdfPath) {
      return reply.status(404).send({ error: "PDF não encontrado" });
    }
    const filePath = path.join(__dirname, '..', 'Uploads', path.basename(orcamento.pdfPath));
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: "Arquivo PDF não encontrado no servidor" });
    }
    reply.header('Content-Type', 'application/pdf');
    return reply.send(fs.createReadStream(filePath));
  } catch (error) {
    console.error("Erro ao buscar PDF:", error);
    return reply.status(500).send({ error: "Erro ao buscar PDF" });
  }
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
      // Busca o item e seus pedidos
      const item = await prisma.item.findUnique({
        where: { id },
        include: { pedidos: true }
      });

      if (!item) {
        return reply.status(404).send({ error: "Item não encontrado" });
      }

      const itemAntes = { status: item.status };

      // Atualiza o item
      const updatedItem = await prisma.item.update({
        where: { id },
        data: { status },
        include: { pedidos: true }
      });

      // Atualizar status dos pedidos relacionados
      if (updatedItem.pedidos && updatedItem.pedidos.length > 0) {
        await prisma.pedido.updateMany({
          where: {
            itemId: id,
            status: { not: "CANCELADO" } // Não atualiza pedidos cancelados
          },
          data: { status }
        });

        // Registra no histórico de cada pedido
        for (const pedido of updatedItem.pedidos) {
          await HistoryService.registrar(
            'STATUS_ALTERADO',
            'PEDIDO',
            pedido.id,
            request,
            { status: pedido.status },
            { status }
          );
        }
      }

      // Registra no histórico do item
      await HistoryService.registrar(
        'STATUS_ALTERADO',
        'ITEM',
        id,
        request,
        itemAntes,
        { status: updatedItem.status }
      );

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
      description, // Novo campo
      dataEmissao,
      operacao,
      status,
    } = request.body as {
      itemId: string;
      cliente: string;
      quantidade: number;
      material: string;
      description?: string; // Campo opcional
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
          description, // Inclui description se presente
          dataEmissao: new Date(dataEmissao),
          operacao,
          status: status || 'PENDENTE', // Define padrão se não fornecido
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
      console.error("Erro ao criar pedido:", err);
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
          take: 1,
          select: {
            id: true,
            cliente: true,
            quantidade: true,
            material: true,
            operacao: true,
            dataEmissao: true,
   
            description: true, // Explicitly include description
            status: true,
          },
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


fastify.get('/metrics/processing-time', async (request, reply) => {
  try {
    const historico = await prisma.historico.findMany({
      where: {
        entidade: { in: ['ORCAMENTO', 'PEDIDO'] },
        acao: 'STATUS_ALTERADO',
      },
      include: {
        pedido: { select: { dataEmissao: true } },
        orcamento: { select: { dataEmissao: true } },
      },
    });

    const metrics = historico.map(h => {
      const dataEmissao = h.pedido?.dataEmissao || h.orcamento?.dataEmissao;
      if (!dataEmissao) return null;
      const processingTime = (new Date(h.createdAt).getTime() - new Date(dataEmissao).getTime()) / (1000 * 60 * 60 * 24);
      return {
        entidadeId: h.entidadeId,
        entidade: h.entidade,
        processingTime,
      };
    }).filter(Boolean);

    return reply.send(metrics);
  } catch (error) {
    console.error('Erro ao calcular tempo de processamento:', error);
    return reply.status(500).send({ error: 'Erro ao calcular métricas' });
  }
});


  fastify.patch("/pedidos/:id/status", async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    if (!["EM_ANDAMENTO", "CONCLUIDO", "CANCELADO"].includes(status)) {
      return reply.status(400).send({ error: "Status inválido" });
    }

    try {
      // Busca o pedido e o item relacionado
      const pedido = await prisma.pedido.findUnique({
        where: { id },
        include: { item: true }
      });

      if (!pedido) {
        return reply.status(404).send({ error: "Pedido não encontrado" });
      }

      const pedidoAntes = { status: pedido.status };

      // Atualiza o pedido
      const pedidoAtualizado = await prisma.pedido.update({
        where: { id },
        data: { status },
      });

      // Atualiza o status do item relacionado, se necessário
      if (pedido.itemId) {
        await prisma.item.update({
          where: { id: pedido.itemId },
          data: { status }
        });

        // Registra a alteração no histórico do item
        await HistoryService.registrar(
          'STATUS_ALTERADO',
          'ITEM',
          pedido.itemId,
          request,
          { status: pedido.item.status },
          { status }
        );
      }

      await HistoryService.registrar(
        'STATUS_ALTERADO',
        'PEDIDO',
        id,
        request,
        pedidoAntes,
        { status: pedidoAtualizado.status }
      );

      return reply.send(pedidoAtualizado);
    } catch (err) {
      return reply.status(404).send({ error: "Pedido não encontrado" });
    }
  });


  fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads/',
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

  fastify.delete('/items/:id', {
    preHandler: [fastify.authenticate]
  }, async (request: FastifyRequestWithUser, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      // Validação do ID
      if (!id || typeof id !== 'string' || id.trim() === '') {
        return reply.status(400).send({ error: 'ID do item inválido' });
      }

      // Verificar se o item existe
      const item = await prisma.item.findUnique({
        where: { id },
        include: { files: true, pedidos: true, orcamentos: true }
      });

      if (!item) {
        return reply.status(404).send({ error: 'Item não encontrado' });
      }

      // Buscar IDs de pedidos e orçamentos associados
      const pedidoIds = item.pedidos.map(p => p.id);
      const orcamentoIds = item.orcamentos.map(o => o.id);

      // Apagar histórico relacionado ao item, pedidos e orçamentos
      await prisma.historico.deleteMany({
        where: {
          OR: [
            { entidade: 'ITEM', entidadeId: id },
            { entidade: 'PEDIDO', entidadeId: { in: pedidoIds } },
            { entidade: 'ORCAMENTO', entidadeId: { in: orcamentoIds } }
          ]
        }
      });

      // Apagar arquivos associados (ItemFile)
      await prisma.itemFile.deleteMany({
        where: { itemId: id }
      });

      // Apagar o item (pedidos e orçamentos são excluídos automaticamente por onDelete: Cascade)
      const deletedItem = await prisma.item.delete({
        where: { id }
      });

      // Registrar a exclusão no histórico
      await HistoryService.registrar(
        'DELETAR',
        'ITEM',
        id,
        request,
        deletedItem,
        null
      );

      return reply.status(200).send({ success: true, message: 'Item e entidades relacionadas excluídos com sucesso' });
    } catch (error: any) {
      console.error('Erro ao excluir item:', {
        message: error.message,
        code: error.code,
        meta: error.meta,
        stack: error.stack
      });
      if (error.code === 'P2025') {
        return reply.status(404).send({ error: 'Item não encontrado' });
      }
      if (error.code === 'P2014') {
        return reply.status(400).send({ error: 'Não é possível excluir o item devido a arquivos associados' });
      }
      return reply.status(500).send({
        error: 'Erro interno ao excluir item',
        details: process.env.NODE_ENV === 'development' ? error.message : null
      });
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

      // Verifica o status atual do item
      const item = await prisma.item.findUnique({
        where: { id: orcamento.itemId }
      });

      if (!item) {
        return reply.status(404).send({ error: "Item relacionado não encontrado" });
      }

      // Verifica se o item já está em andamento ou concluído
      if (item.status === 'EM_ANDAMENTO' || item.status === 'CONCLUIDO') {
        return reply.status(400).send({
          error: "Item já está em andamento ou concluído",
          itemStatus: item.status
        });
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

      // Atualiza o status do item primeiro
      await prisma.item.update({
        where: { id: orcamento.itemId },
        data: { status: "EM_ANDAMENTO" }
      });

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

      // Registra a atualização do status do item
      await HistoryService.registrar(
        'STATUS_ALTERADO',
        'ITEM',
        orcamento.itemId,
        request,
        { status: item.status },
        { status: "EM_ANDAMENTO" }
      );

      return reply.status(201).send({
        pedido,
        itemAtualizado: {
          id: orcamento.itemId,
          novoStatus: "EM_ANDAMENTO"
        }
      });
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

  // Rotas de Empresas
  fastify.get("/empresas", async (request, reply) => {
    try {
      const empresas = await prisma.empresa.findMany({ orderBy: { createdAt: 'desc' } });
      return reply.send(empresas);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao buscar empresas" });
    }
  });

  fastify.post("/empresas", async (request, reply) => {
    const data = request.body as any;
    try {
      const empresa = await prisma.empresa.create({ data });
      return reply.send(empresa);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao criar empresa" });
    }
  });

  fastify.put("/empresas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as any;
    try {
      const empresa = await prisma.empresa.update({ where: { id }, data });
      return reply.send(empresa);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao atualizar empresa" });
    }
  });

  fastify.delete("/empresas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.empresa.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao excluir empresa" });
    }
  });

  // Rotas de Ferramentas (Estoque)
  fastify.get("/ferramentas", async (request, reply) => {
    try {
      const ferramentas = await prisma.ferramenta.findMany({ orderBy: { createdAt: 'desc' } });
      return reply.send(ferramentas);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao buscar ferramentas" });
    }
  });

  fastify.post("/ferramentas", async (request, reply) => {
    const data = request.body as any;
    try {
      const ferramenta = await prisma.ferramenta.create({ data });
      return reply.send(ferramenta);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao criar ferramenta" });
    }
  });

  fastify.put("/ferramentas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as any;
    try {
      const ferramenta = await prisma.ferramenta.update({ where: { id }, data });
      return reply.send(ferramenta);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao atualizar ferramenta" });
    }
  });

  fastify.delete("/ferramentas/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.ferramenta.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao excluir ferramenta" });
    }
  });

  fastify.patch("/ferramentas/:id/quantidade", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { delta, novaQuantidade } = request.body as any;
    try {
      if (novaQuantidade !== undefined) {
         const ferramenta = await prisma.ferramenta.update({ where: { id }, data: { quantidade: novaQuantidade }});
         return reply.send(ferramenta);
      }
      const ferramenta = await prisma.ferramenta.findUnique({ where: { id } });
      if (!ferramenta) return reply.status(404).send({ error: "Não encontrado" });
      const updated = await prisma.ferramenta.update({ where: { id }, data: { quantidade: Math.max(0, ferramenta.quantidade + delta) }});
      return reply.send(updated);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao atualizar quantidade" });
    }
  });

  // Rotas de Pedidos de Compra (Estoque)
  fastify.get("/pedidos-compra", async (request, reply) => {
    try {
      const pedidos = await prisma.pedidoCompra.findMany({ orderBy: { createdAt: 'desc' } });
      return reply.send(pedidos);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao buscar pedidos" });
    }
  });

  fastify.post("/pedidos-compra", async (request, reply) => {
    const data = request.body as any;
    try {
      const pedido = await prisma.pedidoCompra.create({ data });
      return reply.send(pedido);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao criar pedido de compra" });
    }
  });

  fastify.patch("/pedidos-compra/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as any;
    try {
      const pedido = await prisma.pedidoCompra.update({ where: { id }, data: { status } });
      return reply.send(pedido);
    } catch (err) {
      return reply.status(500).send({ error: "Erro ao atualizar pedido" });
    }
  });
}