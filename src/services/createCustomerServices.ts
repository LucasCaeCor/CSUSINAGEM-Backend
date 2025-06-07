import prismaClient from "../prisma";
import bcrypt from "bcrypt";

interface CreateCustomerProps {
    name: string;
    email: string;
    password: string;
    role?: 'USER' | 'ADMIN'; // agora você pode informar o tipo de conta
}


class CreateCustomerService {
  async execute({ name, email, password, role = "USER" }: CreateCustomerProps) {
    if (!name || !email || !password) {
      throw new Error("Preencha todos os campos");
    }

    // Verifica se email já existe
    const existingCustomer = await prismaClient.customer.findFirst({
      where: { email },
    });

    if (existingCustomer) {
      throw new Error("Email já cadastrado");
    }

    // Criptografa a senha
    const hashedPassword = await bcrypt.hash(password, 10);

    const customer = await prismaClient.customer.create({
      data: {
        name,
        email,
        password: hashedPassword,
        status: true,
        role, // agora aceita "USER" ou "ADMIN"
      },
    });

    return customer;
  }
}


export { CreateCustomerService };
