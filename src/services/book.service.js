// services/book.service.js
//
// Audiobook support (issue #200): uploads the audio file (MP3/M4A) to
// Cloudinary and attaches the resulting URL / public id / duration to the
// book. Cloudinary reports the duration of audio files when they are uploaded
// with `resource_type: "video"`, which is what feeds the player progress bar.

import cloudinary from "../utils/cloudinary.js";
import Book from "../models/Book.js";
import { validateMagicBytes } from "../utils/fileValidation.js";

// Magic-byte MIME types the audio upload accepts. `file-type` reports MP3 as
// audio/mpeg and M4A as audio/mp4.
const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp4"];

export class BookService {
  /**
   * Validate + upload an audio file to Cloudinary.
   *
   * @param {object} params
   * @param {Buffer} params.buffer - Raw audio file bytes.
   * @returns {Promise<{secureUrl: string, publicId: string, duration: number}>}
   *   Upload result. `duration` is seconds as reported by Cloudinary (0 when
   *   unavailable, e.g. for mocked uploads in tests).
   * @throws {Error} When the buffer is empty or its magic bytes are not an
   *   accepted audio format.
   */
  async uploadAudio({ buffer }) {
    if (!buffer || buffer.length === 0) {
      throw new Error("Audio file is required");
    }

    const isValid = await validateMagicBytes(buffer, AUDIO_MIME_TYPES);
    if (!isValid) {
      throw new Error(
        "Invalid audio content detected. Magic bytes do not match MP3 or M4A."
      );
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "library-books/audio",
          // Audio files are uploaded as the "video" resource type so
          // Cloudinary parses the container and returns the duration.
          resource_type: "video",
          type: "authenticated",
        },
        (error, uploadResult) => {
          if (error) reject(error);
          else resolve(uploadResult);
        }
      );
      stream.end(buffer);
    });

    return {
      secureUrl: result.secure_url,
      publicId: result.public_id,
      duration: Number(result.duration) || 0,
    };
  }

  /**
   * Attach audio metadata to a book (create-time or later replacement).
   *
   * @param {object} params
   * @param {string} params.bookId - Book ObjectId.
   * @param {string} params.audioFileUrl - Public Cloudinary audio URL.
   * @param {string} params.audioFilePublicId - Cloudinary public id (used to
   *   mint signed streaming URLs).
   * @param {number} [params.duration] - Audio duration in seconds.
   * @returns {Promise<object|null>} Updated book, or null when not found.
   */
  async attachAudio({ bookId, audioFileUrl, audioFilePublicId, duration }) {
    return Book.findByIdAndUpdate(
      bookId,
      {
        $set: {
          audioFileUrl,
          audioFilePublicId,
          duration: Number(duration) || 0,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
  }

  /**
   * Mint a short-lived signed URL for streaming an authenticated audio file.
   *
   * @param {object} book - Book document with `audioFilePublicId`.
   * @returns {string} Signed Cloudinary download URL valid for 1 hour.
   */
  getSignedAudioUrl(book) {
    return cloudinary.utils.private_download_url(
      book.audioFilePublicId,
      "video",
      { expires_at: Math.floor(Date.now() / 1000) + 3600 } // 1 hour
    );
  }
}

export const bookService = new BookService();
export default bookService;
