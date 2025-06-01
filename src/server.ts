import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { routes } from './routes';

const app = Fastify({ logger: true });

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://172.27.64.1:5173",
    "https://csusinagem-frontend.vercel.app"
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};


const start = async () => {
  await app.register(cors, {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://172.27.64.1:5173",
      "https://csusinagem-frontend.vercel.app"
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    preflightContinue: false, // garantir que o Fastify responde o OPTIONS
    optionsSuccessStatus: 204, // status padrão para resposta OPTIONS
  });

  await app.register(cors, corsOptions);

  app.register(fastifyMultipart);
  await app.register(routes);

  app.setErrorHandler((error, request, reply) => {
    reply.code(400).send({ message: error.message });
  });

  try {
    await app.listen({ port: 3333 });
    console.log('Server rodando na porta 3333');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
