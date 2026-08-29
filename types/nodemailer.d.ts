declare module "nodemailer" {
  type TransportOptions = Record<string, unknown>;
  type MailOptions = Record<string, unknown>;
  type Transporter = {
    verify(): Promise<unknown>;
    sendMail(options: MailOptions): Promise<unknown>;
  };
  const nodemailer: {
    createTransport(options: TransportOptions): Transporter;
  };
  export default nodemailer;
}
