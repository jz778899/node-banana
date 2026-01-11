import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "@/utils/logger";

// Helper to get file extension from MIME type
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return mimeToExt[mimeType] || "mp4";
}

// Helper to detect if a string is an HTTP URL
function isHttpUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

// POST: Save a generated image or video to the generations folder
export async function POST(request: NextRequest) {
  let directoryPath: string | undefined;
  try {
    const body = await request.json();
    directoryPath = body.directoryPath;
    const image = body.image;
    const video = body.video;
    const prompt = body.prompt;
    const imageId = body.imageId; // Optional ID for carousel support

    const isVideo = !!video;
    const content = video || image;

    logger.info('file.save', 'Generation auto-save request received', {
      directoryPath,
      hasImage: !!image,
      hasVideo: !!video,
      prompt,
    });

    if (!directoryPath || !content) {
      logger.warn('file.save', 'Generation save validation failed: missing fields', {
        hasDirectoryPath: !!directoryPath,
        hasContent: !!content,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate directory exists
    try {
      const stats = await fs.stat(directoryPath);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Generation save failed: path is not a directory', {
          directoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      logger.warn('file.error', 'Generation save failed: directory does not exist', {
        directoryPath,
      });
      return NextResponse.json(
        { success: false, error: "Directory does not exist" },
        { status: 400 }
      );
    }

    let buffer: Buffer;
    let extension: string;

    if (isHttpUrl(content)) {
      // Handle HTTP URL (common for large video files from providers)
      logger.info('file.save', 'Fetching content from URL', { url: content.substring(0, 100) });

      const response = await fetch(content);
      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || (isVideo ? "video/mp4" : "image/png");
      extension = getExtensionFromMime(contentType);

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // Handle base64 data URL
      const dataUrlMatch = content.match(/^data:([\w/+-]+);base64,/);
      if (dataUrlMatch) {
        const mimeType = dataUrlMatch[1];
        extension = getExtensionFromMime(mimeType);
        const base64Data = content.replace(/^data:[\w/+-]+;base64,/, "");
        buffer = Buffer.from(base64Data, "base64");
      } else {
        // Fallback: assume it's raw base64 without data URL prefix
        extension = isVideo ? "mp4" : "png";
        buffer = Buffer.from(content, "base64");
      }
    }

    // Generate filename
    let filename: string;
    if (imageId) {
      filename = `${imageId}.${extension}`;
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const promptSnippet = prompt
        ? prompt
            .slice(0, 30)
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .toLowerCase()
        : "generation";
      filename = `${timestamp}_${promptSnippet}.${extension}`;
    }
    const filePath = path.join(directoryPath, filename);

    // Write the file
    await fs.writeFile(filePath, buffer);

    logger.info('file.save', 'Generation auto-saved successfully', {
      filePath,
      filename,
      fileSize: buffer.length,
      isVideo,
    });

    return NextResponse.json({
      success: true,
      filePath,
      filename,
      imageId: imageId || filename.replace(`.${extension}`, ''),
    });
  } catch (error) {
    logger.error('file.error', 'Failed to save generation', {
      directoryPath,
    }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Save failed",
      },
      { status: 500 }
    );
  }
}
