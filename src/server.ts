import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { routes } from './routes';

const app = Fastify({ logger: true });

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://172.27.64.1:5173",
  "https://csusinagem-frontend.vercel.app"
];

const start = async () => {
  // ✅ REGISTRO ÚNICO DO CORS
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed"), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.register(fastifyMultipart);
  await app.register(routes);

  app.setErrorHandler((error, request, reply) => {
    reply.code(400).send({ message: error.message });
  });

  try {
    await app.listen({ port: 3333, host: '0.0.0.0' }); // 🔧 adicione host 0.0.0.0 para produção
    console.log('✅ Server rodando na porta 3333');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
