const sharp = require('sharp');
const { httpError } = require('../utils/httpError');

// Фото зберігається як компактний JPEG у профілі; URL сторонніх серверів не завантажуємо.
async function normalizeAvatar(buffer) {
  const png = buffer?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer?.[0] === 255 && buffer?.[1] === 216 && buffer?.[2] === 255;
  const webp = buffer?.subarray(0, 4).toString() === 'RIFF' && buffer?.subarray(8, 12).toString() === 'WEBP';
  if (!png && !jpeg && !webp) throw httpError(400, 'Choose a PNG, JPEG or WebP image.', { code: 'INVALID_PHOTO' });
  try {
    const image = await sharp(buffer, { limitInputPixels: 16000000, failOn: 'warning' })
      .rotate().resize(256, 256, { fit: 'cover', position: 'attention' }).flatten({ background: '#FFFFFF' })
      .jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${image.toString('base64')}`;
  } catch {
    throw httpError(400, 'The image could not be read. Choose an image up to 16 megapixels.', { code: 'INVALID_PHOTO' });
  }
}
module.exports = { normalizeAvatar };
