import { FastifyRequest, FastifyReply } from "fastify";
import {ListCustomerService } from '../services/listCustomerService'

class ListCustomer{
    async handle(request:FastifyRequest, reply:FastifyReply){
const listCustomerService = new ListCustomerService();

const customers = await listCustomerService.execute();

reply.send(customers);

    }

}

export {ListCustomer}
