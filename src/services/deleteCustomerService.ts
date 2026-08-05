import prismaClient from "../prisma";

interface DeleteCustomerProps {
  id: string;
}

class DeleteCustomerService {
    
  async execute({ id }: DeleteCustomerProps) {
    if (!id) {
      throw new Error("Solicitação inválida.");
    }

    const findCustomer = await prismaClient.customer.findUnique({
      where: { id },
    });

    if (!findCustomer) {
      throw new Error("Cliente não existe.");
    }

    await prismaClient.customer.delete({
      where: { id },
    });

    return { message: "Deletado com sucesso!" };
  }
}

export { DeleteCustomerService };
