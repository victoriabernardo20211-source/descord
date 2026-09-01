-- Anexos de conversa privada passam a ser cifrados no dispositivo.
-- `uploadId` liga a linha à chave que vive dentro do envelope Megolm.
ALTER TABLE "DirectMessageAttachment" ADD COLUMN "uploadId" TEXT;
ALTER TABLE "DirectMessageAttachment" ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false;
