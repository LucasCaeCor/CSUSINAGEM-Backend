import { google, Auth } from 'googleapis';
import path from 'path';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import { URL } from 'url';
import http from 'http';
import { pipeline } from 'stream/promises';
import stream from 'stream'; // Importação explícita para tipagem

class GoogleDriveService {
  private static SCOPES = ['https://www.googleapis.com/auth/drive.file'];
  private static TOKEN_PATH = path.join(process.cwd(), 'token.json');
  private static CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
  private static FOLDER_NAME = 'CsUsinagemBackups';
  private static folderId: string | null = null;

  private static instance: GoogleDriveService;
  private auth: any;

  private constructor() {
    this.initializeAuth();
  }

  public static getInstance(): GoogleDriveService {
    if (!GoogleDriveService.instance) {
      GoogleDriveService.instance = new GoogleDriveService();
    }
    return GoogleDriveService.instance;
  }


  public async extractZip(zipPath: string, baseDir: string): Promise<string[]> {
    console.log(`Iniciando extração do ZIP: ${zipPath} para ${baseDir}`);
    const extractedFiles: string[] = [];
    try {
      await fs.ensureDir(baseDir);
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      console.log(`Entradas no ZIP: ${zipEntries.map(entry => entry.entryName)}`);
      zip.extractAllTo(baseDir, true);
      console.log(`Extração concluída para ${baseDir}`);
      const files = await fs.readdir(baseDir, { withFileTypes: true });
      console.log(`Conteúdo do diretório: ${JSON.stringify(files.map(f => ({ name: f.name, isFile: f.isFile() })))}`);
      extractedFiles.push(
        ...files
          .filter(dirent => dirent.isFile())
          .map(dirent => path.join(baseDir, dirent.name).replace(/\\/g, '/'))
      );
    } catch (err: any) {
      console.error(`Erro ao extrair ZIP: ${err.message}`, err);
      throw new Error(`Falha ao extrair ZIP: ${err.message}`);
    }
    return extractedFiles;
  }



  async listFilesInFolder(folderId: string) {
    const drive = google.drive({ version: 'v3', auth: this.auth });

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
    });
    return res.data.files || [];
  }

  private initializeAuth() {
    try {
      if (!process.env.GOOGLE_CREDENTIALS) {
        throw new Error('Variável GOOGLE_CREDENTIALS não configurada');
      }

      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

      if (!credentials || typeof credentials !== 'object') {
        throw new Error('Credenciais inválidas ou mal formatadas');
      }

      if (credentials.type === 'service_account') {
        this.auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/drive']
        });
      } else {
        if (!credentials.client_id || !credentials.client_secret) {
          throw new Error('Credenciais OAuth incompletas - faltando client_id ou client_secret');
        }

        const redirectUri = credentials.redirect_uris?.[0] || 'http://localhost:3333/auth/callback';

        this.auth = new google.auth.OAuth2(
          credentials.client_id,
          credentials.client_secret,
          redirectUri
        );

        if (credentials.refresh_token) {
          this.auth.setCredentials({
            refresh_token: credentials.refresh_token
          });
        } else if (credentials.access_token) {
          this.auth.setCredentials({
            access_token: credentials.access_token
          });
        }
      }
    } catch (error) {
      console.error('Erro na inicialização do Google Drive:', error);
      throw error;
    }
  }

  public async verifyCredentials() {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const response = await drive.about.get({
        fields: 'user'
      });
      console.log('Autenticado como:', response.data.user);
      return true;
    } catch (error) {
      console.error('Falha na verificação de credenciais:', error);
      return false;
    }
  }

  public determineBackupType(filename: string): 'database' | 'files' | 'full' {
    const lowerFilename = filename.toLowerCase();
    const cleanFilename = lowerFilename.replace(/_\d{4}-\d{2}-\d{2}t.*$/, '');

    if (cleanFilename.includes('completo') || cleanFilename.includes('full')) {
      return 'full';
    }
    if (
      cleanFilename.includes('database') ||
      cleanFilename.includes('customers') ||
      (cleanFilename.endsWith('.json') && !cleanFilename.includes('arquivos'))
    ) {
      return 'database';
    }
    if (cleanFilename.includes('arquivos') || cleanFilename.endsWith('.tar.gz') || cleanFilename.endsWith('.zip')) {
      return 'files';
    }
    return 'files';
  }

  public async downloadFile(fileId: string, destinationPath: string) {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const file = await drive.files.get({ fileId, fields: 'name', supportsAllDrives: true });
      const dest = require('fs').createWriteStream(destinationPath);

      const res = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
      await pipeline(res.data as stream.Readable, dest);
      return { name: file.data.name };
    } catch (error) {
      console.error('Erro ao baixar arquivo:', { message: error.message });
      throw error;
    }
  }

  public async listBackups() {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      if (!folderId) {
        throw new Error('Variável GOOGLE_DRIVE_FOLDER_ID não configurada');
      }
      console.log(`Buscando backups na pasta com ID: ${folderId}`);
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, createdTime, size, mimeType, webViewLink, parents)',
        orderBy: 'createdTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 100
      });
      console.log('Resposta do Google Drive:', {
        fileCount: response.data.files?.length || 0,
        files: response.data.files?.map(f => ({ id: f.id, name: f.name, parents: f.parents })) || [],
        query: `'${folderId}' in parents and trashed = false`
      });
      return {
        success: true,
        data: response.data.files || [],
        error: null
      };
    } catch (error) {
      console.error('Erro ao listar backups:', {
        message: error.message,
        stack: error.stack,
        folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
        response: error.response?.data
      });
      throw error;
    }
  }

  public static async authorize(): Promise<Auth.OAuth2Client> {
    const credentials = await fs.readJson(this.CREDENTIALS_PATH);

    const oAuth2Client = new google.auth.OAuth2(
      credentials.web.client_id,
      credentials.web.client_secret,
      credentials.web.redirect_uris[0]
    );

    try {
      const token = await fs.readJson(this.TOKEN_PATH);
      oAuth2Client.setCredentials(token);
      return oAuth2Client;
    } catch (err) {
      return this.getNewToken(oAuth2Client);
    }
  }

  private static async getNewToken(oAuth2Client: Auth.OAuth2Client): Promise<Auth.OAuth2Client> {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.SCOPES,
      prompt: 'consent'
    });

    console.log('Autorize este aplicativo acessando este URL:', authUrl);

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url) return;

          const url = new URL(req.url, `http://${req.headers.host}`);
          const code = url.searchParams.get('code');

          if (code) {
            res.end('Autenticação concluída! Você pode fechar esta janela.');
            server.close();

            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            await fs.writeJson(this.TOKEN_PATH, tokens);
            resolve(oAuth2Client);
          }
        } catch (error) {
          reject(error);
        }
      }).listen(3000, () => {
        console.log('Servidor de autenticação iniciado em http://localhost:3000');
        console.log('Aguardando autorização...');
      });
    });
  }

  public static async ensureBackupFolder(): Promise<string> {
    if (this.folderId) return this.folderId;

    const auth = await this.authorize();
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.list({
      q: `name='${this.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (res.data.files?.length) {
      this.folderId = res.data.files[0].id!;
      return this.folderId;
    }

    const folder = await drive.files.create({
      requestBody: {
        name: this.FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    this.folderId = folder.data.id!;
    return this.folderId;
  }

  public static async uploadFile(filePath: string, fileName: string, folderId?: string): Promise<string> {
    const auth = await this.authorize();
    const drive = google.drive({ version: 'v3', auth });

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`O caminho fornecido não é um arquivo válido: ${filePath}`);
    }

    const fileMetadata = {
      name: fileName,
      parents: [folderId || (await this.ensureBackupFolder())]
    };

    const media = {
      mimeType: this.getMimeType(fileName),
      body: fs.createReadStream(filePath)
    };

    try {
      const file = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id,name,webViewLink'
      });

      console.log(`Arquivo enviado com sucesso: ${file.data.webViewLink}`);
      return file.data.id!;
    } catch (error) {
      console.error('Erro ao enviar arquivo:', error);
      throw new Error('Falha ao enviar arquivo para o Google Drive');
    }
  }

  private static getMimeType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'json': 'application/json',
      'zip': 'application/zip',
      'pdf': 'application/pdf',
      'dwg': 'image/vnd.dwg',
      'jpg': 'image/jpeg',
      'png': 'image/png',
    };
    return mimeTypes[extension] || 'application/octet-stream';
  }

  public static async uploadJsonBackup(data: any, fileName: string): Promise<string> {
    const auth = await this.authorize();
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await this.ensureBackupFolder();

    const fileMetadata = {
      name: `${fileName}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      parents: [folderId],
    };

    const media = {
      mimeType: 'application/json',
      body: JSON.stringify(data, null, 2),
    };

    try {
      const file = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id,webViewLink',
      });

      console.log('Backup criado com sucesso. Acesso:', file.data.webViewLink);
      return file.data.id!;
    } catch (error) {
      console.error('Erro ao criar backup:', error);
      throw error;
    }
  }

  // Nova implementação para upload de múltiplos arquivos extraídos
  public static async uploadExtractedFilesToDrive(sourceDir: string, folderId: string): Promise<string[]> {
    const files = await fs.readdir(sourceDir);
    const uploadedFiles: string[] = [];

    for (const file of files) {
      const filePath = path.join(sourceDir, file);
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        const fileId = await this.uploadFile(filePath, file, folderId);
        uploadedFiles.push(fileId);
        console.log(`Enviado ${file} para o Google Drive com ID ${fileId}`);
      }
    }

    return uploadedFiles;
  }

  public static async moveFilesToLocal(sourceDir: string, destDir: string): Promise<{ originalPath: string, newPath: string }[]> {
    try {
      await fs.ensureDir(destDir); // Garante que o diretório de destino exista
      const files = await fs.readdir(sourceDir, { withFileTypes: true });
      const movedFiles: { originalPath: string, newPath: string }[] = [];

      for (const file of files) {
        const sourcePath = path.join(sourceDir, file.name);
        const destPath = path.join(destDir, file.name);
        if (file.isFile()) {
          await fs.copyFile(sourcePath, destPath);
          await fs.chmod(destPath, 0o644); // Permissões para arquivos
          console.log(`Movido: ${sourcePath} -> ${destPath}`);
          movedFiles.push({ originalPath: sourcePath, newPath: destPath });
        } else if (file.isDirectory()) {
          await fs.ensureDir(destPath);
          const subMovedFiles = await this.moveFilesToLocal(sourcePath, destPath); // Recursivo para subdiretórios
          movedFiles.push(...subMovedFiles);
        }
      }
      await fs.chmod(destDir, 0o755); // Permissões para o diretório
      return movedFiles;
    } catch (error: any) {
      console.error(`Erro ao mover arquivos de ${sourceDir} para ${destDir}:`, error);
      throw new Error(`Falha ao mover arquivos: ${error.message}`);
    }
  }

  public static getRelativePath(filePath: string, baseDir: string): string {
    return path.relative(baseDir, filePath).replace(/\\/g, '/'); // Normaliza para barras forward

  }
}

export default GoogleDriveService;