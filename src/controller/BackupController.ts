import { FastifyRequest, FastifyReply } from 'fastify';
import GoogleDriveService from '../services/googleDriveService';
import prisma from '../prisma';
import { DateTime } from 'luxon';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import archiver from 'archiver';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import zlib from 'zlib';
import { google } from 'googleapis';

const pump = promisify(pipeline);

export class BackupController {
  private auth: any;

  public async verifyCredentials() {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const about = await drive.about.get({ fields: 'user' });
      console.log('Autenticado como:', about.data.user);
      return true;
    } catch (error) {
      console.error('Falha na autenticação:', error);
      return false;
    }
  }

  public async listBackups() {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

      console.log(`Buscando arquivos na pasta ${folderId}...`);
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, createdTime, size, mimeType, webViewLink, fileExtension)',
        orderBy: 'createdTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 100
      });

      console.log('Resposta completa do Google Drive:', {
        filesCount: response.data.files?.length,
        sampleFile: response.data.files?.[0]
      });

      if (!response.data.files || response.data.files.length === 0) {
        console.warn('Nenhum arquivo encontrado na pasta especificada');
        return [];
      }

      return response.data.files.map(file => ({
        id: file.id!,
        name: file.name!,
        createdTime: file.createdTime!,
        size: file.size ? `${Math.round(Number(file.size) / 1024 / 1024)} MB` : '0 MB',
        type: file.fileExtension || file.mimeType?.split('/').pop() || 'file',
        webViewLink: file.webViewLink!
      }));

    } catch (error) {
      console.error('Erro detalhado no GoogleDriveService:', error);
      throw error;
    }
  }


  public getBackupType(filename: string): 'full' | 'database' | 'files' {
    if (filename.includes('full_backup')) return 'full';
    if (filename.includes('database_backup')) return 'database';
    return 'files';
  }


  private static async getAllData() {
    try {
      const uploadsDir = process.env.FILES_DIR || '/opt/render/project/src/uploads';
      const [
        customers,
        categories,
        items,
        item_files,
        pedidos,
        orcamentos,
        historico,
        orcamento_pdfs,
        Sequence
      ] = await Promise.all([
        prisma.customer.findMany(),
        prisma.category.findMany({ include: { items: true } }),
        prisma.item.findMany({ include: { files: true, pedidos: true, orcamentos: true } }),
        prisma.itemFile.findMany(),
        prisma.pedido.findMany({ include: { item: true } }),
        prisma.orcamento.findMany({ include: { item: true } }),
        prisma.historico.findMany(),
        prisma.orcamentoPdf.findMany(),
        prisma.sequence.findMany()
      ]);

      // Normalizar caminhos para serem relativos ao diretório FILES_DIR
      const normalizedItemFiles = item_files.map(file => ({
        ...file,
        path: GoogleDriveService.getRelativePath(file.path, uploadsDir)
      }));

      const normalizedOrcamentoPdfs = orcamento_pdfs.map(pdf => ({
        ...pdf,
        pdfPath: GoogleDriveService.getRelativePath(pdf.pdfPath, uploadsDir)
      }));

      return {
        metadata: {
          backupDate: DateTime.now().toISO(),
          totalRecords: {
            customers: customers.length,
            categories: categories.length,
            items: items.length,
            item_files: item_files.length,
            pedidos: pedidos.length,
            orcamentos: orcamentos.length,
            historico: historico.length,
            orcamento_pdfs: orcamento_pdfs.length,
            Sequence: Sequence.length
          },
          baseDir: 'uploads' // Indicar o diretório base para restauração
        },
        customers,
        categories,
        items,
        item_files: normalizedItemFiles,
        pedidos,
        orcamentos,
        historico,
        orcamento_pdfs: normalizedOrcamentoPdfs,
        Sequence
      };
    } catch (error) {
      console.error('Erro em getAllData:', error);
      throw error;
    }
  }

  private static async getTableData(tableName: string) {
    switch (tableName) {
      case 'customers':
        return prisma.customer.findMany();
      case 'categories':
        return prisma.category.findMany({ include: { items: true } });
      case 'items':
        return prisma.item.findMany({
          include: { files: true, pedidos: true, orcamentos: true }
        });
      case 'item_files':
        return prisma.itemFile.findMany();
      case 'pedidos':
        return prisma.pedido.findMany({ include: { item: true } });
      case 'orcamentos':
        return prisma.orcamento.findMany({ include: { item: true } });
      case 'historico':
        return prisma.historico.findMany();
      case 'orcamento_pdfs':
        return prisma.orcamentoPdf.findMany();
      case 'Sequence':
        return prisma.sequence.findMany();
      default:
        throw new Error(`Tabela ${tableName} não encontrada`);
    }
  }

  private static async backupFilesToTemp(): Promise<string> {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const backupDir = path.join(__dirname, '..', '..', 'temp_backup');

    // Verifica se o diretório de uploads existe
    if (!fs.existsSync(uploadsDir)) {
      throw new Error(`Diretório de uploads não encontrado: ${uploadsDir}`);
    }

    // Cria diretório temporário se não existir
    await fs.ensureDir(backupDir);

    // Nome do arquivo de backup
    const backupFileName = `backup_arquivos_${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.zip`;
    const backupPath = path.join(backupDir, backupFileName);

    // Compacta o diretório
    await this.compressDirectory(uploadsDir, backupPath);

    return backupPath;
  }


  async uploadFile(filePath: string, fileName: string, folderId?: string): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: this.auth });

    const fileMetadata = {
      name: fileName,
      parents: folderId ? [folderId] : [process.env.GOOGLE_DRIVE_FOLDER_ID],
    };

    const media = {
      body: fs.createReadStream(filePath),
    };

    const res = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id',
    });

    return res.data.id!;
  }


  private static async compressDirectory(source: string, destination: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destination);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Nível máximo de compressão
      });

      output.on('close', () => {
        console.log(`Backup compactado: ${archive.pointer()} bytes`);
        resolve(destination);
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('Aviso de arquivo não encontrado:', err);
        } else {
          reject(err);
        }
      });

      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // Adicione todo o conteúdo do diretório ao arquivo zip
      archive.directory(source, false);

      archive.finalize();
    });
  }

  async fullBackup(request: FastifyRequest, reply: FastifyReply) {
    try {
      // 1. Backup dos dados do banco
      const allData = await BackupController.getAllData();
      const jsonFileName = `backup_completo_${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.json`;

      // 2. Upload do JSON para o Google Drive
      const jsonFileId = await GoogleDriveService.uploadJsonBackup(allData, jsonFileName);

      // 3. Backup dos arquivos
      let filesBackupId = null;
      try {
        const tempBackupPath = await BackupController.backupFilesToTemp();
        filesBackupId = await GoogleDriveService.uploadFile(
          tempBackupPath,
          path.basename(tempBackupPath)
        );

        // 4. Limpeza do arquivo temporário
        await fs.remove(tempBackupPath);
      } catch (filesError) {
        console.error('Aviso: Falha no backup de arquivos, continuando sem arquivos...', filesError);
      }

      return reply.send({
        success: true,
        message: 'Backup principal realizado com sucesso' + (filesBackupId ? ' (com arquivos)' : ' (sem arquivos)'),
        backupIds: {
          database: jsonFileId,
          files: filesBackupId
        },
        stats: allData.metadata.totalRecords
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no backup completo';
      console.error('Erro no backup completo:', error);
      return reply.status(500).send({
        success: false,
        message: 'Falha no backup completo',
        error: errorMessage
      });
    }
  }

  async tableBackup(request: FastifyRequest<{ Params: { table: string } }>, reply: FastifyReply) {
    try {
      const { table } = request.params;
      const tableData = await BackupController.getTableData(table);

      const fileId = await GoogleDriveService.uploadJsonBackup(
        tableData,
        `backup_${table}_${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}`
      );

      return reply.send({
        success: true,
        message: `Backup da tabela ${table} realizado com sucesso`,
        fileId,
        recordCount: Array.isArray(tableData) ? tableData.length : 1
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no backup da tabela';
      return reply.status(500).send({
        success: false,
        message: `Falha no backup da tabela ${request.params.table}`,
        error: errorMessage
      });
    }
  }

  async backupFiles(request: FastifyRequest, reply: FastifyReply) {
    try {
      // 1. Criar backup compactado dos arquivos
      const tempBackupPath = await BackupController.backupFilesToTemp();

      // 2. Upload para o Google Drive
      const fileId = await GoogleDriveService.uploadFile(
        tempBackupPath,
        path.basename(tempBackupPath) // Usar uploadFile em vez de uploadJsonBackup
      );

      // 3. Limpeza do arquivo temporário
      await fs.remove(tempBackupPath);

      return reply.send({
        success: true,
        message: 'Backup de arquivos realizado com sucesso',
        fileId
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no backup de arquivos';
      console.error('Erro no backup de arquivos:', error);
      return reply.status(500).send({
        success: false,
        message: 'Falha no backup de arquivos',
        error: errorMessage
      });
    }
  }
}