import { BackupController } from '../controller/BackupController';
import { DateTime } from 'luxon';
import cron from 'node-cron';

const backupController = new BackupController();

// Backup completo diário às 2h
cron.schedule('0 2 * * *', async () => {
  console.log('Iniciando backup agendado...', DateTime.now().toISO());
  
  try {
    // Simula request/reply do Fastify
    const request = {};
    const reply = {
      send: (result: any) => console.log('Backup concluído:', result),
      status: () => ({ send: (error: any) => console.error('Erro no backup:', error) })
    };
    
    await backupController.fullBackup(request as any, reply as any);
  } catch (error) {
    console.error('Erro no backup agendado:', error);
  }
});

console.log('Agendador de backup iniciado. Próximo backup às 2h.');