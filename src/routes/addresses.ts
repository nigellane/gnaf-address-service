import { Router } from 'express';
import { AddressController } from '../controllers/addressController';
import { authenticateApiKey } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiting';

const router = Router();
const addressController = new AddressController();

router.get('/search', authenticateApiKey, rateLimit, addressController.searchAddresses);
router.post('/validate', authenticateApiKey, rateLimit, addressController.validateAddress);
router.post('/geocode', authenticateApiKey, rateLimit, addressController.geocodeAddress);
router.get('/reverse-geocode', authenticateApiKey, rateLimit, addressController.reverseGeocode);
router.get('/health', addressController.healthCheck);

export default router;