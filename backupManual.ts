import { BackupController } from '../CSUSINAGEM-Backend-main/src/controller/BackupController';
import { DateTime } from 'luxon';

async function runManualBackup() {
  console.log('Iniciando backup manual...');
  console.log(DateTime.now().toISO());

  const backupController = new BackupController();
  
  // Simulando request e reply do Fastify
  const request = {};
  const reply = {
    send: (result: any) => {
      console.log('\nBackup realizado com sucesso:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    },
    status: (code: number) => ({
      send: (error: any) => {
        console.error('\nErro no backup:');
        if (typeof error === 'object' && error !== null) {
          console.error(JSON.stringify(error, null, 2));
        } else {
          console.error(error);
        }
        process.exit(1);
      }
    })
  };

  try {
    console.log('Executando backup completo...');
    await backupController.fullBackup(request as any, reply as any);
    
    console.log('Backup de tabelas...');
    await backupController.tableBackup({ params: { table: 'customers' } } as any, reply as any);
    
    console.log('Backup de arquivos...');
    await backupController.backupFiles(request as any, reply as any);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('\nErro inesperado:', errorMessage);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

runManualBackup();