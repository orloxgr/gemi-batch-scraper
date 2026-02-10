# GEMI Industrial Scraper (v4.0)

A robust, industrial-scale userscript for the Greek General Commercial Registry (GEMI). 
Designed to extract company details (Status, KAD, Partners, Contact info) securely and efficiently.

## Features
* **Industrial Scale:** Uses `IndexedDB` to handle queues of 200,000+ URLs without crashing browser memory.
* **Memory Safe:** Automatically exports CSV chunks every 50 rows and clears RAM.
* **Stateful:** Auto-resumes exactly where it left off if the browser crashes or internet fails.
* **Excel Ready:** Exports CSVs with BOM encoding for perfect Greek character rendering in Excel.
* **Turbo Mode:** Optimized for speed (~1.5s per company).

## Installation

1.  Install the [Tampermonkey](https://www.tampermonkey.net/) extension for Chrome/Edge/Firefox.
2.  [**CLICK HERE TO INSTALL**](PASTE_YOUR_RAW_LINK_HERE) 
    *(Replace the link above with your actual Raw URL)*.
3.  Click **Install** when the Tampermonkey tab appears.

## How to Use

1.  **Prepare your list:** Create a `.txt` file with one GEMI URL per line (e.g., `https://publicity.businessportal.gr/company/123456789000`).
2.  **Navigate:** Go to any company page on [publicity.businessportal.gr](https://publicity.businessportal.gr/).
3.  **Load:** The scraper UI will appear in the top right. Click "Choose File" and select your `.txt` list.
4.  **Start:** Click **Start**. The script will save the queue to the internal database and begin.
5.  **Export:** It will automatically download CSV chunks every 50 rows.
    * *Interruption?* Just refresh the page. It will auto-resume.

## ⚠️ Legal & GDPR Disclaimer

**Educational Purposes Only.**
This software is provided for educational and data management purposes only.

* **GDPR Warning:** The data extracted contains personal information (e.g., names of partners, contact details). Under the **General Data Protection Regulation (GDPR)** and Greek Law **3471/2006**, you may **NOT** use this data for unsolicited marketing (spam) without a specific legal basis.
* **Liability:** The author is not responsible for any misuse of this data or any legal consequences arising from the use of this tool.
* **Terms of Service:** Use responsibly. Do not overload the GEMI servers.

## License
MIT License
