"use client";

import { useState } from "react";

// Types
type Item = { name: string; price: number };
type ReceiptData = { items: Item[]; vat: number; serviceCharge: number };

export default function BillSplitter() {
  const [persons, setPersons] = useState<string[]>(["A", "B", "C"]);
  const [newPerson, setNewPerson] = useState("");
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [assignments, setAssignments] = useState<Record<number, string[]>>({});
  const [includeServiceCharge, setIncludeServiceCharge] = useState(false);
  const [includeVat, setIncludeVat] = useState(false);
  
  // State สำหรับ API และ Image
  const [apiKey, setApiKey] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPerson = () => {
    if (newPerson && !persons.includes(newPerson)) {
      setPersons([...persons, newPerson]);
      setNewPerson("");
    }
  };

  const toggleAssignment = (itemIndex: number, person: string) => {
    setAssignments((prev) => {
      const currentAssigned = prev[itemIndex] || [];
      if (currentAssigned.includes(person)) {
        return { ...prev, [itemIndex]: currentAssigned.filter((p) => p !== person) };
      } else {
        return { ...prev, [itemIndex]: [...currentAssigned, person] };
      }
    });
  };

  // จัดการเมื่อผู้ใช้อัปโหลดรูปภาพ
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setReceiptData(null); // Reset ข้อมูลเดิม
      setAssignments({});
      setIncludeServiceCharge(false);
      setIncludeVat(false);
      setError(null);
    }
  };

  // แปลงไฟล์รูปภาพเป็น Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  // ยิง API ไปที่ Gemini
  const extractReceiptData = async () => {
    if (!apiKey) {
      setError("กรุณากรอก Gemini API Key");
      return;
    }
    if (!imageFile) {
      setError("กรุณาอัปโหลดรูปภาพใบเสร็จ");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const base64Image = await fileToBase64(imageFile);
      
      // Prompt สั่งให้ AI ดึงข้อมูลและบังคับ Output เป็น JSON เท่านั้น
      const prompt = `
        Analyze this restaurant receipt image carefully and extract the information into a specific JSON format.
        
        Rules for Extraction:
        1. Extract all food/drink items with their final prices.
        2. Discount Handling: If there is a discount applied specifically to an item (e.g., "Food1 50" followed by "Discount Food1 -5"), subtract the discount from the original price and output ONLY the final net price for that item (e.g., {"name": "Food1", "price": 45}). Do NOT list the discount as a separate item.
        3. Exclude 0 Baht Items: Ignore and remove any lines with a price of 0 if they are just informational, promotional text, or irrelevant to the actual consumable items.
        4. Extract the total VAT (Tax) amount and Service Charge amount if they exist. If they do not exist, set them to 0.
        
        Return ONLY a valid JSON object strictly matching this format without any markdown blocks or explanations:
        {
          "items": [
            {"name": "Item name 1", "price": 100},
            {"name": "Item name 2", "price": 150}
          ],
          "vat": 17.5,
          "serviceCharge": 25
        }
      `;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: imageFile.type, data: base64Image } },
                ],
              },
            ],
          }),
        }
      );

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "API Error");
      }

      // ดึง Text ออกมาจาก Response
      let textResponse = data.candidates[0].content.parts[0].text;
      
      // ลบ Markdown formatting (เช่น ```json และ ```) กรณีที่ AI เผลอส่งมา
      textResponse = textResponse.replace(/```json/gi, "").replace(/```/gi, "").trim();

      const parsedData = JSON.parse(textResponse) as ReceiptData;
      setReceiptData(parsedData);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "เกิดข้อผิดพลาดในการประมวลผลข้อมูล กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsLoading(false);
    }
  };

  // ตรรกะคำนวณเงิน
  const calculateTotals = () => {
    if (!receiptData) return [];
    let baseTotals: Record<string, number> = {};
    let totalAssignedCost = 0;
    persons.forEach((p) => (baseTotals[p] = 0));

    receiptData.items.forEach((item, index) => {
      const assignedTo = assignments[index] || [];
      if (assignedTo.length > 0) {
        const costPerPerson = item.price / assignedTo.length;
        assignedTo.forEach((p) => {
          baseTotals[p] += costPerPerson;
          totalAssignedCost += costPerPerson;
        });
      }
    });

    return persons.map((person) => {
      const baseCost = baseTotals[person];
      const proportion = totalAssignedCost > 0 ? baseCost / totalAssignedCost : 0;
      const scShare = includeServiceCharge ? receiptData.serviceCharge * proportion : 0;
      const vatShare = includeVat ? receiptData.vat * proportion : 0;
      const total = baseCost + scShare + vatShare;

      return { name: person, baseCost, scShare, vatShare, total };
    }).filter((p) => p.baseCost > 0);
  };

  const results = calculateTotals();

  return (
    <main className="min-h-screen p-4 py-8 sm:p-8 lg:p-12 text-slate-800">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="relative overflow-hidden rounded-[32px] border border-white/60 bg-white/70 p-6 shadow-[0_25px_80px_rgba(109,94,252,0.12)] backdrop-blur-xl sm:p-8">
          <div className="absolute -left-12 top-0 h-32 w-32 rounded-full bg-violet-300/30 blur-3xl" />
          <div className="absolute right-10 top-8 h-24 w-24 rounded-full bg-emerald-300/30 blur-3xl" />

          <div className="relative text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-violet-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Smart dining
            </div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              BillDai
            </h1>
          </div>
        </header>

        <section className="rounded-[28px] border border-slate-200/70 bg-white/80 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                Gemini API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">
                อัปโหลดใบเสร็จ
              </label>
              <label className="group flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-300 hover:from-violet-100 hover:to-indigo-100">
                <span>{imageFile ? imageFile.name : "Choose receipt image"}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={extractReceiptData}
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 px-6 py-3 text-sm font-bold text-white shadow-[0_18px_30px_rgba(99,102,241,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_35px_rgba(99,102,241,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "กำลังประมวลผล..." : "ดึงข้อมูลใบเสร็จ"}
            </button>
          </div>

          {imagePreview && (
            <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 p-3 shadow-inner">
              <img
                src={imagePreview}
                alt="Receipt preview"
                className="max-h-80 w-full rounded-2xl object-contain"
              />
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
              {error}
            </p>
          )}
        </section>

        {receiptData && (
          <section className="grid gap-8 lg:grid-cols-[1.5fr_0.9fr]">
            <div className="overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/80 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-6">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-2xl font-bold text-slate-900">เลือกรายการที่ทาน</h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newPerson}
                    onChange={(e) => setNewPerson(e.target.value)}
                    placeholder="เพิ่มชื่อเพื่อน..."
                    className="w-32 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:bg-white"
                  />
                  <button
                    onClick={addPerson}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white shadow-sm transition hover:scale-105 hover:bg-slate-700"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead>
                    <tr>
                      <th className="border-b border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">
                        รายการอาหาร
                      </th>
                      <th className="border-b border-slate-200 bg-slate-50 px-3 py-3 text-right text-sm font-semibold text-slate-700">
                        ราคา
                      </th>
                      {persons.map((p) => (
                        <th
                          key={p}
                          className="border-b border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-700"
                        >
                          {p}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {receiptData.items.map((item, idx) => (
                      <tr key={idx} className="transition hover:bg-violet-50/40">
                        <td className="border-b border-slate-200 px-3 py-3 text-sm font-medium text-slate-800">
                          {item.name}
                        </td>
                        <td className="border-b border-slate-200 px-3 py-3 text-right text-sm font-medium text-slate-800">
                          {item.price.toLocaleString()}฿
                        </td>
                        {persons.map((p) => (
                          <td
                            key={p}
                            className="border-b border-slate-200 px-3 py-3 text-center align-middle"
                          >
                            <input
                              type="checkbox"
                              className="h-5 w-5 cursor-pointer accent-violet-600"
                              checked={(assignments[idx] || []).includes(p)}
                              onChange={() => toggleAssignment(idx, p)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className="rounded-[28px] border border-slate-200/70 bg-gradient-to-br from-slate-900 via-slate-800 to-violet-900 p-5 text-white shadow-[0_20px_60px_rgba(15,23,42,0.2)] sm:p-6">
              <h2 className="text-2xl font-bold">สรุปยอดสุทธิ</h2>
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <span>ค่าอาหารรวม</span>
                  <span className="font-semibold text-white">
                    {receiptData.items.reduce((sum, item) => sum + item.price, 0).toLocaleString()} ฿
                  </span>
                </div>

                <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-400"
                      checked={includeServiceCharge}
                      onChange={(e) => setIncludeServiceCharge(e.target.checked)}
                    />
                    Service Charge
                  </span>
                  {includeServiceCharge && (
                    <span className="font-medium text-emerald-300">
                      {receiptData.serviceCharge.toLocaleString()} ฿
                    </span>
                  )}
                </label>

                <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-400"
                      checked={includeVat}
                      onChange={(e) => setIncludeVat(e.target.checked)}
                    />
                    VAT
                  </span>
                  {includeVat && (
                    <span className="font-medium text-emerald-300">
                      {receiptData.vat.toLocaleString()} ฿
                    </span>
                  )}
                </label>
              </div>

              <div className="mt-6 space-y-4">
                {results.map((res, idx) => (
                  <div
                    key={idx}
                    className="flex items-end justify-between gap-3 border-b border-white/10 pb-4"
                  >
                    <div>
                      <p className="text-lg font-bold text-white">{res.name}</p>
                      <p className="mt-1 text-xs text-slate-300">
                        อาหาร {res.baseCost.toFixed(2)}
                        {includeServiceCharge && ` | SC ${res.scShare.toFixed(2)}`}
                        {includeVat && ` | VAT ${res.vatShare.toFixed(2)}`}
                      </p>
                    </div>
                    <p className="text-xl font-black text-emerald-300">
                      {res.total.toFixed(2)} ฿
                    </p>
                  </div>
                ))}

                {results.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-3 py-5 text-center text-sm text-slate-300">
                    กรุณาติ๊กเลือกรายการอาหารให้แต่ละคน
                  </p>
                )}
              </div>
            </aside>
          </section>
        )}
      </div>
    </main>
  );
}