import mongoose from 'mongoose';

const CollectionSchema = new mongoose.Schema({
  code: { type: String, unique: true, index: true },
  name: { type: String, required: true },
  adminKey: { type: String, default: 'admin' }, // 생성시에만 사용
}, { timestamps: true });

export default mongoose.model('Collection', CollectionSchema);
