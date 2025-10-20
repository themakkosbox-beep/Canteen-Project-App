export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-center mb-8 text-camp-700">
        Camp Canteen POS System
      </h1>
      
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center space-y-4">
          <p className="text-lg text-gray-600">
            Welcome to the Camp Canteen Point of Sale System
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
            <a 
              href="/pos" 
              className="bg-camp-500 hover:bg-camp-600 text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 text-center block"
            >
              Open POS Terminal
            </a>
            
            <a 
              href="/admin" 
              className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 text-center block"
            >
              Admin Panel
            </a>
          </div>
          
          <div className="mt-8 text-sm text-gray-500">
            <p>Features:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Prepaid customer accounts with 4-digit IDs</li>
              <li>Barcode scanning for instant purchases</li>
              <li>Complete transaction logging</li>
              <li>Offline-first operation</li>
              <li>Balance adjustments and deposits</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}