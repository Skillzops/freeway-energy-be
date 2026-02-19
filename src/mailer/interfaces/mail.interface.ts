import { ISendMailOptions } from "@nestjs-modules/mailer";

export interface IMail extends ISendMailOptions {
  to: string;
  subject: string;
  [key: string]: any;
  userId?: string;
}
