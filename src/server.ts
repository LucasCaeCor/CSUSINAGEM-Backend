
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyJwt from '@fastify/jwt';
import { routes } from './routes';

const app = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024 // 100MB
});

const allowedOrigins = process.env.CORS_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? [];

const start = async () => {
  // Registro do CORS
  await app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition'],
    credentials: true,
  });

  // Registro do plugin multipart com limite de tamanho
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB por arquivo
      files: 10, // Máximo de 10 arquivos por requisição
      fieldSize: 100 * 1024 * 1024 // 100MB para campos
    }
  });

  // Registro das rotas
  await app.register(routes);

  // Registro do JWT
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'DATABASE_URL' // Use variável de ambiente para o segredo
  });

  // Manipulador de erros personalizado
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);
    if (error.message.includes('file too large')) {
      return reply.status(413).send({
        error: 'Arquivo muito grande',
        details: 'O tamanho do arquivo excede o limite de 50MB por arquivo ou 100MB total.'
      });
    }
    return reply.status(400).send({
      error: 'Erro ao processar a requisição',
      details: error.message
    });
  });

  try {
    await app.listen({ port: 3333, host: '0.0.0.0' });
    console.log('✅ Server rodando na porta 3333');
  } catch (err) {
    console.error('Erro ao iniciar o servidor:', err);
    process.exit(1);
  }
};

start();