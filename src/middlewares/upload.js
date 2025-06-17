// middleware/upload.js
import multer from "multer";
const storage = multer.memoryStorage(); // In-memory buffer
const upload = multer({ storage });
export default upload;
