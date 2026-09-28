// import request from 'supertest';
// import express from 'express';
// import pharmacyDashboardRouter from '../routes/v1/dashboard.route';
// import { errorHandler } from '../../../middlewear/errorHandler';
// import { PharmacyDashboardService } from '../services/dashboard.service';

// const app = express();
// app.use(express.json());
// app.use('/api/v1/pharmacy/dashboard', pharmacyDashboardRouter);
// app.use(errorHandler);

// describe('Pharmacy Dashboard Integration Tests', () => {
//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//     (PharmacyDashboardService.getSummary as jest.Mock).mockResolvedValue(
//       mockResult
//     );

//     const response = await request(app).get(
//       '/api/v1/pharmacy/dashboard/summary?pharmacyId=123e4567-e89b-12d3-a456-426614174001'
//     );

//     (
//       PharmacyDashboardService.getTopSellingMedicines as jest.Mock
//     ).mockResolvedValue(mockRows);

//     const response = await request(app).get(
//       '/api/v1/pharmacy/dashboard/top-selling?pharmacyId=123e4567-e89b-12d3-a456-426614174001&limit=10'
//     );

//     (PharmacyDashboardService.getStockHealth as jest.Mock).mockResolvedValue(
//       mockResult
//     );

//     const response = await request(app).get(
//       '/api/v1/pharmacy/dashboard/stock-health?pharmacyId=123e4567-e89b-12d3-a456-426614174001&status=ALL&pageNumber=1&pageSize=10'
//     );
