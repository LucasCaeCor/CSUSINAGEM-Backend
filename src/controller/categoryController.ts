import { FastifyRequest, FastifyReply } from "fastify";
import prisma from "../prisma";


export const getCategories = async (request: FastifyRequest, reply: FastifyReply) => {
  const categories = await prisma.category.findMany();
  return reply.send(categories);
};

export const createCategory = async (request: FastifyRequest, reply: FastifyReply) => {
  const { name, imagePath } = (request.body as any);

  if (!name || !imagePath) {
    return reply.status(400).send({ error: 'Nome e imagem obrigatórios' });
  }

  const category = await prisma.category.create({
    data: {
      name,
      imagePath,
    },
  });

  return reply.status(201).send(category);
};

export async function getCategoryById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  try {
    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      return reply.status(404).send({ message: "Categoria não encontrada" });
    }

    return reply.send(category);
  } catch (err) {
    return reply.status(500).send({ message: "Erro ao buscar categoria", error: err });
  }
}
