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
    return new ListCustomer().handle(request, reply);
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

  try {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!category) {
      return reply.status(404).send({ message: "Categoria não encontrada" });
    }

    return reply.send(category.items);
  } catch (err) {
    return reply.status(500).send({ message: "Erro ao buscar itens da categoria", error: err });
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
    },
  });

  return reply.status(201).send(newItem);
});



fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'uploads'),
  prefix: '/uploads', // Ex: http://localhost:3333/uploads/image.jpg
});




  }

  


