import prismaClient from '../prisma';
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

interface AuthProps {
  email: string;
  password: string;
}

export class AuthService {
  verifyToken(token: string): { id: string; name: string; email: string; role: string } {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret") as any;
      return {
        id: decoded.sub || decoded.customerId,
        name: decoded.name || "Desconhecido",
        email: decoded.email,
        role: decoded.role || "USER",
      };
    } catch (err) {
      throw new Error("Token inválido");
    }
  }

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

    const isValidPassword = await bcrypt.compare(password, customer.password);
    if (!isValidPassword) {
      console.log("Falha: senha incorreta");
      throw new Error("Email ou senha inválidos");
    }

    console.log("Autenticação bem sucedida para:", email);

    const token = jwt.sign(
      {
        sub: customer.id, // Padrão JWT
        name: customer.name || "Desconhecido",
        email: customer.email,
        role: customer.role || "USER", // Incluir role
      },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1h" }
    );

    return { token, name: customer.name || "Desconhecido" };
  }
}