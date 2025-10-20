# Camp Canteen POS System

A point-of-sale system designed for camp canteens with prepaid customer accounts, barcode scanning, and complete offline functionality.

## Features

- **Prepaid Customer Accounts**: Each camper has a unique 4-digit ID with prepaid balance
- **Instant Barcode Scanning**: Scan barcodes for immediate purchase deduction
- **Complete Transaction Logging**: Every purchase, deposit, and adjustment is logged
- **Offline-First Design**: Works completely offline with local SQLite database
- **Balance Management**: Easy deposits and adjustments with optional notes
- **Real-time Updates**: Customer balance and transaction history update instantly

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set up the Database

```bash
npm run db:setup
```

This will create a SQLite database with sample customers and products.

### 3. Start the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Usage

### For Staff (POS Terminal)

1. Go to `/pos` or click "Open POS Terminal" from the home page
2. Enter customer's 4-digit ID (sample IDs: 1234, 5678, 9012)
3. Scan barcodes or manually enter for purchases
4. Use deposit/adjustment forms for balance changes
5. All transactions are logged automatically

### Sample Data

The system comes with sample customers and products:

**Customers:**
- ID: 1234 (Alice Johnson) - $25.00 balance
- ID: 5678 (Bob Smith) - $30.00 balance  
- ID: 9012 (Charlie Brown) - $15.50 balance

**Products:**
- Snickers Bar: $2.50 (Barcode: 012345678901)
- Kit Kat: $2.25 (Barcode: 012345678902)
- Gatorade Blue: $3.00 (Barcode: 012345678903)
- Coca Cola: $2.75 (Barcode: 012345678904)
- Red Bull: $4.50 (Barcode: 012345678905)

## Technical Details

### Architecture

- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: SQLite backed by sql.js (no native build required)
- **Offline-First**: All data stored locally, no internet required

### Database Schema

#### Customers Table
- `customer_id`: 4-digit unique identifier
- `name`: Optional customer name
- `balance`: Current prepaid balance
- Timestamps for creation and updates

#### Products Table
- `product_id`: Unique product identifier
- `name`: Product name
- `price`: Product price
- `barcode`: Unique barcode for scanning
- `category`: Product category
- `active`: Enable/disable products

#### Transactions Table
- `transaction_id`: Unique transaction identifier
- `customer_id`: Reference to customer
- `type`: purchase, deposit, withdrawal, adjustment
- `product_id`: Reference to product (for purchases)
- `amount`: Transaction amount (negative for purchases)
- `balance_after`: Customer balance after transaction
- `note`: Optional note for deposits/adjustments
- `timestamp`: Transaction timestamp

### API Endpoints

- `GET /api/customers/[customerId]` - Get customer details
- `GET /api/customers/[customerId]/transactions` - Get customer transaction history
- `POST /api/transactions/purchase` - Process barcode purchase
- `POST /api/transactions/deposit` - Add funds to customer account
- `POST /api/transactions/adjustment` - Adjust customer balance

## Future Enhancements

The system is designed to be modular and expandable:

- **Hot Food Ticket Printing**: Framework ready for thermal printer integration
- **Staff User Roles**: PIN-based authentication for different permission levels
- **Reports & Analytics**: Daily sales, popular items, profit tracking
- **Mobile App**: PWA conversion for tablet/phone use
- **Cloud Sync**: Optional cloud backup and multi-location sync

## Development

### Project Structure

```
src/
├── app/
│   ├── api/          # API routes
│   ├── pos/          # POS terminal page
│   └── page.tsx      # Home page
├── lib/
│   └── database.ts   # Database utilities
├── types/
│   └── database.ts   # TypeScript interfaces
└── styles/
    └── globals.css   # Global styles
```

### Adding Products

Products can be added directly to the database or through the admin interface (future feature). Each product needs:

- Unique product ID
- Name and price
- Unique barcode
- Category (optional)

### Adding Customers

Customers can be added with their 4-digit ID and initial balance. Names are optional for privacy.

## Troubleshooting

### Installation
- The project uses `sql.js`, so `npm install` succeeds without Visual Studio build tools
- Ensure Node.js 18 or newer is installed; rerun `npm install` if the `sql-wasm.wasm` asset is missing

### Database Issues
- If database errors occur, try deleting `canteen.db` and running `npm run db:setup` again
- Check that the `scripts/setup-db.js` file has proper permissions

### Barcode Scanning
- Use a USB barcode scanner configured as keyboard input
- Test with sample barcodes: 012345678901, 012345678902, etc.
- Ensure the barcode input field is focused

### Performance
- SQLite database can handle thousands of transactions efficiently
- Consider periodic database maintenance for large-scale deployments

## License

MIT License - feel free to modify and distribute for your camp's needs.

## Support

This system was designed specifically for camp canteens. For questions or modifications, refer to the code comments and TypeScript interfaces for guidance.