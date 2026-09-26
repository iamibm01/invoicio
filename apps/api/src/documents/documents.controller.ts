import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { DocumentsService } from './documents.service.js';
import { MAX_UPLOAD_BYTES } from './upload-rules.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * One file per request, so the client gets per-file progress and errors.
   * Multer keeps the file in memory; the size limit (413 when exceeded) keeps
   * that bounded.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    return this.documents.upload(user, file);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.documents.list(user.businessId);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.getDetail(user.businessId, id);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { stream, mimeType, filename } = await this.documents.getFile(user.businessId, id);
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }
}
