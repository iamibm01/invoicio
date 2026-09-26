import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { SubmitReviewDto } from './dto/submit-review.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller('documents')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Saves a reviewer's corrections and confirms the document's extracted values. */
  @Post(':id/review')
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitReviewDto,
  ) {
    return this.reviews.submit(user, id, body.corrections);
  }
}
