import { FastifyInstance } from 'fastify';
import GoogleDriveService from '../services/googleDriveService';

import path from 'path';
import { tmpdir } from 'os';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { MongoClient, ObjectId } from 'mongodb';

function parseDate(dateStr: any): Date {
  if (!dateStr) return new Date();
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? new Date() : date;
}

async function restoreDatabase(jsonData: any) {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error('DATABASE_URL não está definido');
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('BancoAppGerenciamento');

    const idMapping: Record<string, ObjectId> = {};

    for (const collectionName of Object.keys(jsonData)) {
      if (!Array.isArray(jsonData[collectionName]) || collectionName === 'metadata') continue;
      await db.collection(collectionName).deleteMany({});
    }

    const filesByItemId: Record<string, any[]> = {};
    if (Array.isArray(jsonData.item_files)) {
      for (const file of jsonData.item_files) {
        const origItemId = file.itemId && typeof file.itemId === 'string' ? file.itemId : null;
        if (!origItemId) continue;
        filesByItemId[origItemId] = filesByItemId[origItemId] || [];
        filesByItemId[origItemId].push(file);
      }
    }
    const driveService = GoogleDriveService.getInstance();


    const collectionOrder = ['categories', 'items', 'item_files', 'customers', 'historico', 'pedidos', 'orcamentos', 'orcamento_pdfs', 'sequences'];

    for (const collectionName of collectionOrder) {
      const data = jsonData[collectionName];
      if (!Array.isArray(data)) continue;

      for (const item of data) {
        const originalId = item._id && typeof item._id === 'string' ? item._id : item.id && typeof item.id === 'string' ? item.id : new ObjectId().toString();
        const newId = new ObjectId();
        idMapping[originalId] = newId;

        let cleanItem;

        switch (collectionName) {
          case 'categories':
            cleanItem = {
              _id: newId,
              name: item.name || '',
              imagePath: item.imagePath || '',
              createdAt: parseDate(item.createdAt),
            };
            break;
          case 'items':
            cleanItem = {
              _id: newId,
              name: item.name || '',
              subname: item.subname || '',
              createdAt: parseDate(item.createdAt),
              categoryId: item.categoryId && idMapping[item.categoryId] ? idMapping[item.categoryId] : null,
              status: item.status || 'PENDENTE',
              itemType: item.itemType,
              files: (filesByItemId[originalId] || []).map((file: any) => {
                const fileName = path.basename(file.path || '');
                return {
                  _id: file.id && idMapping[file.id] ? idMapping[file.id] : new ObjectId(),
                  path: fileName ? `${fileName}` : file.path || '',
                  type: file.type || 'IMAGE',
                  itemId: newId,
                  createdAt: parseDate(file.createdAt),
                };
              }),
              pedidos: item.pedidos || [],
              orcamentos: item.orcamentos || [],
            };
            break;
          case 'item_files':
            const fileName = path.basename(item.path || '');
            cleanItem = {
              _id: newId,
              path: fileName ? `${fileName}` : item.path || '',
              type: item.type || 'IMAGE',
              itemId: item.itemId && idMapping[item.itemId] ? idMapping[item.itemId] : null,
              createdAt: parseDate(item.createdAt),
            };
            break;
          case 'customers':
            cleanItem = {
              _id: newId,
              name: item.name || '',
              email: item.email || '',
              password: item.password || '',
              status: item.status !== undefined ? item.status : true,
              role: item.role || 'USER',
              created_at: parseDate(item.created_at),
              updated_at: parseDate(item.updated_at),
            };
            break;
          case 'historico':
            cleanItem = {
              _id: newId,
              acao: item.acao || '',
              entidade: item.entidade || '',
              entidadeId: item.entidadeId && idMapping[item.entidadeId] ? idMapping[item.entidadeId] : null,
              dados: item.dados || '{}',
              usuarioId: item.usuarioId && idMapping[item.usuarioId] ? idMapping[item.usuarioId] : null,
              usuarioNome: item.usuarioNome || '',
              createdAt: parseDate(item.createdAt),
            };
            break;
          case 'pedidos':
            cleanItem = {
              _id: newId,
              quantidade: item.quantidade || 0,
              material: item.material || '',
              dataEmissao: parseDate(item.dataEmissao),
              operacao: item.operacao || '',
              cliente: item.cliente || '',
              itemId: item.itemId && idMapping[item.itemId] ? idMapping[item.itemId] : null,
              createdAt: parseDate(item.createdAt),
              status: item.status || 'PENDENTE',
            };
            break;
          case 'orcamentos':
            cleanItem = {
              _id: newId,
              quantidade: item.quantidade || 0,
              material: item.material || '',
              dataEmissao: parseDate(item.dataEmissao),
              operacao: item.operacao || '',
              cliente: item.cliente || '',
              itemId: item.itemId && idMapping[item.itemId] ? idMapping[item.itemId] : null,
              valor: item.valor || 0,
              createdAt: parseDate(item.createdAt),
              status: item.status || 'PENDENTE',
            };
            break;
          case 'orcamento_pdfs':
            cleanItem = {
              _id: newId,
              numero: item.numero || 0,
              data: parseDate(item.data),
              cliente: item.cliente || '',
              cnpj: item.cnpj || '',
              prazoEntrega: item.prazoEntrega || '',
              frete: item.frete || '',
              condPagamento: item.condPagamento || '',
              items: (item.items || []).map((i: any) => ({
                ...i,
                itemId: i.itemId && idMapping[i.itemId] ? idMapping[i.itemId] : null,
              })),
              valorTotal: item.valorTotal || 0,
              cfop: item.cfop || '',
              valorIcms: item.valorIcms || 0,
              valorIpi: item.valorIpi || 0,
              valorIss: item.iss || 0,
              pdfPath: item.pdfPath ? `${path.basename(item.pdfPath)}` : item.pdfPath || '',
              createdAt: parseDate(item.createdAt),
              updatedAt: parseDate(item.updatedAt),
            };
            break;
          case 'sequences':
            cleanItem = {
              _id: newId,
              name: item.name || '',
              value: item.value || 0,
            };
            break;
          default:
            cleanItem = { _id: newId, ...item };
        }

        await db.collection(collectionName).updateOne(
          { _id: cleanItem._id },
          { $set: cleanItem },
          { upsert: true }
        );
        console.log(`Documento ${newId} inserado em ${collectionName}.`);
      }
    }

    if (jsonData.categories) {
      for (const category of jsonData.categories) {
        if (category.items && Array.isArray(category.items)) {
          for (const item of category.items) {
            const originalItemId = item.id && typeof item.id === 'string' ? item.id : new ObjectId().toString();
            if (idMapping[originalItemId]) continue;

            const newItemId = new ObjectId();
            idMapping[originalItemId] = newItemId;

            const cleanItem = {
              _id: newItemId,
              name: item.name || '',
              subname: item.subname || '',
              createdAt: parseDate(item.createdAt),
              categoryId: category.id && idMapping[category.id] ? idMapping[category.id] : null,
              status: item.status || 'PENDENTE',
              itemType: item.itemType,
              files: (item.files || []).map((file: any) => ({
                _id: file.id && idMapping[file.id] ? idMapping[file.id] : new ObjectId(),
                path: file.path || '',
                type: file.type || 'IMAGE',
                itemId: newItemId,
                createdAt: parseDate(file.createdAt),
              })),
              pedidos: item.pedidos || [],
              orcamentos: item.orcamentos || [],
            };

            await db.collection('items').updateOne(
              { _id: newItemId },
              { $set: cleanItem },
              { upsert: true }
            );
            console.log(`Item ${newItemId} restaurado para a categoria ${idMapping[category.id] || category.id}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro durante a restauração:', error);
    throw error;
  } finally {
    await client.close();
  }
}

export default async function registerRestoreRoutes(fastify: FastifyInstance) {
  fastify.post('/api/restore', async (request, reply) => {
    console.log('Raw request body:', JSON.stringify(request.body, null, 2));
    let restoredFiles: string[] = [];
    let destDir: string | null = null;
    const driveService = GoogleDriveService.getInstance();
    try {

      const { backupId, type, restoreToDrive = false } = request.body as {
        backupId: string;
        fileBackupId?: string;
        type: 'database' | 'files' | 'full';
        restoreToDrive?: boolean;
      };

      let fileBackupId = request.body.fileBackupId;

   

      if (!backupId || !['database', 'files', 'full'].includes(type)) {
        return reply.status(400).send({ error: 'Invalid backupId or type' });
      }

      if ((type === 'files' || type === 'full') && !fileBackupId) {
        console.log('Nenhum fileBackupId fornecido. Buscando ZIP de backup mais recente no Google Drive...');

        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        if (!folderId) {
          return reply.status(500).send({ error: 'GOOGLE_DRIVE_FOLDER_ID não configurada' });
        }

        const backups = await driveService.listFilesInFolder(folderId);
        const zipBackup = backups.find(file =>
          file.name.toLowerCase().includes('backup_arquivos') && file.name.toLowerCase().endsWith('.zip')
        );

        if (!zipBackup) {
          return reply.status(404).send({ error: 'Nenhum backup ZIP encontrado no Google Drive para restauração' });
        }

        fileBackupId = zipBackup.id;
        console.log(`Arquivo ZIP automaticamente selecionado: ${zipBackup.name} (${fileBackupId})`);
      }





      console.log('Iniciando restauração:', { backupId, fileBackupId, type, restoreToDrive });
  
      console.log('Verifying credentials...');
      await driveService.verifyCredentials();

      const tempDir = tmpdir();
      let jsonFilePath: string | undefined;
      let zipFilePath: string | undefined;

      // Restaurar banco de dados
      if (type === 'database' || type === 'full') {
        jsonFilePath = path.join(tempDir, `${backupId}-${Date.now()}.json`);
        console.log(`Downloading JSON ${backupId} to ${jsonFilePath}`);
        const jsonFile = await driveService.downloadFile(backupId, jsonFilePath);
        if (!jsonFile) {
          return reply.status(404).send({ error: 'Arquivo JSON de backup não encontrado' });
        }
        console.log('JSON baixado:', { name: jsonFile.name, path: jsonFilePath });

        const cleanFileName = jsonFile.name.toLowerCase().replace(/_\d{4}-\d{2}-\d{2}t.*$/, '');
        if (cleanFileName.endsWith('.json')) {
          const jsonData = JSON.parse(await fs.readFile(jsonFilePath, 'utf-8'));
          await restoreDatabase(jsonData);
          console.log(`Banco de dados restaurado a partir de ${jsonFile.name}`);
        } else {
          console.warn('Arquivo não é JSON, ignorando restauração de banco:', jsonFile.name);
        }
      }

      // Restaurar arquivos
      if (type === 'files' || type === 'full') {
        zipFilePath = path.join(tempDir, `${fileBackupId}-${Date.now()}.zip`);
        console.log(`Downloading ZIP ${fileBackupId} to ${zipFilePath}`);
        const zipFile = await driveService.downloadFile(fileBackupId!, zipFilePath);
        if (!zipFile) {
          return reply.status(404).send({ error: 'Arquivo ZIP de backup não encontrado' });
        }
        console.log('ZIP baixado:', { name: zipFile.name, path: zipFilePath });

        const cleanFileName = zipFile.name.toLowerCase().replace(/_\d{4}-\d{2}-\d{2}t.*$/, '');
        const isZip = cleanFileName.endsWith('.zip');
        const isTarGz = cleanFileName.endsWith('.tar.gz');

        if (isZip || isTarGz) {
         const destDir = process.env.FILES_DIR || '/opt/render/project/src/';
          console.log(`Diretório de destino configurado: ${destDir}`);

          
          // Criar diretório de destino e definir permissões
          await fs.mkdir(destDir, { recursive: true });
          // await fs.chmod(destDir, 0o755);
          await fs.access(destDir, fs.constants.W_OK).catch(() => {
            throw new Error(`Sem permissão de escrita no diretório de destino: ${destDir}`);
          });

          // Extrair arquivos
          try {
            if (isZip) {
              restoredFiles = await driveService.extractZip(zipFilePath, destDir);
            } else {
              const unzipDir = path.join(tempDir, `unzip-${fileBackupId}`);
              await fs.mkdir(unzipDir, { recursive: true });
              await tar.x({ file: zipFilePath, cwd: unzipDir });
              const movedFiles = await GoogleDriveService.moveFilesToLocal(unzipDir, destDir);
              restoredFiles = movedFiles.map(f => f.newPath);
              await fs.rm(unzipDir, { recursive: true, force: true });
            }
            console.log(`Arquivos restaurados:`, restoredFiles);
          } catch (extractError: any) {
            console.error('Erro ao extrair arquivo:', extractError);
            throw new Error(`Falha ao extrair arquivo ${zipFile.name}: ${extractError.message}`);
          }
        } else {
          throw new Error(`Arquivo ${zipFile.name} não é um backup de arquivos válido (esperado .zip ou .tar.gz)`);
        }
      }

      // Limpeza de arquivos temporários
      if (jsonFilePath) {
        await fs.unlink(jsonFilePath).catch((err) => console.warn('Erro ao remover JSON temporário:', err.message));
      }
      if (zipFilePath) {
        await fs.unlink(zipFilePath).catch((err) => console.warn('Erro ao remover ZIP temporário:', err.message));
      }

      return reply.send({
        success: true,
        message: `Restauração ${type} realizada com sucesso`,
        restoredFiles,
      });
    } catch (error: any) {
      console.error('Erro na restauração:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
      });
      return reply.status(500).send({
        error: 'Erro na restauração',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Falha ao realizar restauração',
      });
    }
  });
}