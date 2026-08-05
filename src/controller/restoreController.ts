// src/controllers/restoreController.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { MongoClient } from 'mongodb';
import { pipeline } from 'stream/promises';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

export const restoreBackup = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { backupId, type } = request.body as {
      backupId: string;
      type: 'full' | 'database' | 'files';
    };

    console.log('Iniciando restauração:', { backupId, type });

    const result = await (type === 'full'
      ? restoreFullBackup(backupId)
      : type === 'database'
        ? restoreDatabase(backupId)
        : restoreFiles(backupId));

    return reply.send({
      success: true,
      message: `Restauração ${type} concluída com sucesso`,
      details: result,
    });
  } catch (error) {
    console.error('Erro na restauração:', error);
    return reply.status(500).send({
      success: false,
      message: error instanceof Error ? error.message : 'Erro desconhecido na restauração',
    });
  }

  async function restoreFullBackup(backupId: string) {
    const drive = google.drive({ version: 'v3', auth });
    const backupsDir = path.join(__dirname, '../../backups');
    await fs.mkdir(backupsDir, { recursive: true });

    // Baixar backup
    const backupPath = path.join(backupsDir, `restore-full-${Date.now()}.zip`);
    const dest = require('fs').createWriteStream(backupPath);
    const res = await drive.files.get(
      { fileId: backupId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    await pipeline(res.data, dest);

    // Extrair .zip
    const unzipDir = path.join(backupsDir, `unzip-full-${Date.now()}`);
    await fs.mkdir(unzipDir, { recursive: true });
    const zip = new AdmZip(backupPath);
    zip.extractAllTo(unzipDir, true);
    const extractedFiles = await fs.readdir(unzipDir);
    console.log('Arquivos extraídos:', extractedFiles);

    // Restaurar banco de dados (se db-backup.json existir)
    const dbBackupPath = path.join(unzipDir, 'db-backup.json');
    if (await fs.access(dbBackupPath).then(() => true).catch(() => false)) {
      await restoreDatabaseFromFile(dbBackupPath);
    } else {
      console.warn('db-backup.json não encontrado no backup full');
    }

    // Restaurar arquivos (se files-backup.zip existir)
    const filesBackupPath = path.join(unzipDir, 'files-backup.zip');
    if (await fs.access(filesBackupPath).then(() => true).catch(() => false)) {
      await restoreFilesFromArchive(filesBackupPath);
    } else {
      console.warn('files-backup.zip não encontrado no backup full');
    }

    // Limpar
    await fs.unlink(backupPath);
    await fs.rm(unzipDir, { recursive: true, force: true });

    return { restored: true, backupId };
  }

  async function restoreDatabase(backupId: string) {
    const drive = google.drive({ version: 'v3', auth });
    const backupsDir = path.join(__dirname, '../../backups');
    await fs.mkdir(backupsDir, { recursive: true });
    const backupPath = path.join(backupsDir, `db-restore-${Date.now()}.json`);

    // Baixar backup
    const dest = require('fs').createWriteStream(backupPath);
    const res = await drive.files.get(
      { fileId: backupId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    await pipeline(res.data, dest);

    // Restaurar MongoDB
    await restoreDatabaseFromFile(backupPath);

    // Limpar
    await fs.unlink(backupPath);

    return { database: process.env.MONGODB_DATABASE, restored: true };
  }

  async function restoreFiles(backupId: string) {
    const drive = google.drive({ version: 'v3', auth });
    const backupsDir = path.join(__dirname, '../../backups');
    await fs.mkdir(backupsDir, { recursive: true });
    const backupPath = path.join(backupsDir, `files-restore-${Date.now()}`);
    const uploadsDir = process.env.FILES_DIR || path.join(__dirname, '../../Uploads');

    // Baixar backup
    const dest = require('fs').createWriteStream(backupPath);
    const res = await drive.files.get(
      { fileId: backupId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    await pipeline(res.data, dest);

    // Verificar extensão do arquivo
    const fileMetadata = await drive.files.get({ fileId: backupId, fields: 'name' });
    const fileName = fileMetadata.data.name?.toLowerCase() || '';
    const isZip = fileName.endsWith('.zip');
    const isTarGz = fileName.endsWith('.tar.gz');

    if (!isZip && !isTarGz) {
      throw new Error(`Arquivo ${fileName} não é um backup de arquivos válido (esperado .zip ou .tar.gz)`);
    }

    // Criar diretório temporário para descompactação
    const unzipDir = path.join(backupsDir, `unzip-${Date.now()}`);
    await fs.mkdir(unzipDir, { recursive: true });

    // Descompactar
    if (isZip) {
      const zip = new AdmZip(backupPath);
      zip.extractAllTo(unzipDir, true);
    } else if (isTarGz) {
      await tar.x({ file: backupPath, cwd: unzipDir });
    }

    const extractedFiles = await fs.readdir(unzipDir);
    if (extractedFiles.length === 0) {
      throw new Error('Nenhum arquivo foi extraído do backup');
    }
    console.log('Arquivos extraídos:', extractedFiles);

    // Mover arquivos para o destino
    await moveFiles(unzipDir, uploadsDir);

    // Limpar
    await fs.unlink(backupPath);
    await fs.rm(unzipDir, { recursive: true, force: true });

    return { filesRestored: true, destination: uploadsDir, restoredFiles: extractedFiles };
  }

  async function moveFiles(sourceDir: string, destDir: string) {
    await fs.mkdir(destDir, { recursive: true });
    const files = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const file of files) {
      const srcPath = path.join(sourceDir, file.name);
      const destPath = path.join(destDir, file.name);

      if (file.isDirectory()) {
        await moveFiles(srcPath, destPath); // Recursivamente mover subdiretórios
      } else {
        console.log(`Movendo ${file.name} para ${destPath}`);
        await fs.copyFile(srcPath, destPath); // Copiar primeiro para evitar falhas
        await fs.unlink(srcPath); // Remover após cópia
      }
    }
  }

  async function restoreDatabaseFromFile(filePath: string) {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DATABASE || 'csusinagem';
    const client = new MongoClient(uri);

    try {
      await client.connect();
      const db = client.db(dbName);
      const jsonData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      console.log('Restaurando coleções:', Object.keys(jsonData));

      for (const [collectionName, data] of Object.entries(jsonData)) {
        if (Array.isArray(data) && data.length > 0) {
          console.log(`Restaurando ${data.length} documentos em ${collectionName}`);
          await db.collection(collectionName).deleteMany({});
          await db.collection(collectionName).insertMany(data);
        } else {
          console.log(`Nenhum dado válido para ${collectionName}`);
        }
      }
      console.log('Restauração do banco de dados concluída');
    } catch (error) {
      console.error('Erro ao restaurar banco de dados:', error);
      throw error;
    } finally {
      await client.close();
    }
  }

  async function restoreFilesFromArchive(archivePath: string) {
    const uploadsDir = process.env.FILES_DIR || path.join(__dirname, '../../Uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const zip = new AdmZip(archivePath);
    zip.extractAllTo(uploadsDir, true);
    const extractedFiles = await fs.readdir(uploadsDir);
    console.log('Arquivos restaurados:', extractedFiles);
  }
};