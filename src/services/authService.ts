import prismaClient from '../prisma';
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

interface AuthProps {
    email: string;
    password: string;
}

export class AuthService {
  async authenticate({ email, password }: AuthProps) {
    console.log("Tentando autenticar usuário:", email);

    if (!email || !password) {
      console.log("Falha: email ou senha não fornecidos");
      throw new Error("Email e senha são obrigatórios");
    }

    const customer = await prismaClient.customer.findUnique({ where: { email } });
    if (!customer) {
      console.log("Falha: cliente não encontrado com email", email);
      throw new Error("Email ou senha inválidos");
    }

    // Log para conferir senha salva no banco (somente para debug; remova depois!)
    console.log("Senha do banco (hash):", customer.password);

    // Para testes, troque para comparação direta:
    // if (password !== customer.password) {
    //   console.log("Falha: senha incorreta");
    //   throw new Error("Email ou senha inválidos");
    // }

    const isValidPassword = await bcrypt.compare(password, customer.password);
    if (!isValidPassword) {
      console.log("Falha: senha incorreta");
      throw new Error("Email ou senha inválidos");
    }

    console.log("Autenticação bem sucedida para:", email);

    const token = jwt.sign(
      { customerId: customer.id, email: customer.email },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1h" }
    );

    return { token, name: customer.name };
  }
}
