import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { routes } from './routes';


const app = Fastify({ logger: true });

app.setErrorHandler((error, request, reply) => {
  reply.code(400).send({ message: error.message });
});

const start = async () => {
  await app.register(cors);
  app.register(fastifyMultipart);  // <- Registra multipart aqui
  await app.register(routes);

  try {
    await app.listen({ port: 3333 });
    console.log('Server rodando na porta 3333');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};



start();
