import { Route, Routes } from "react-router"
import { Layout } from "./components/Layout"
import { Activity } from "./pages/Activity"
import { BondPage } from "./pages/Bond"
import { Compliance } from "./pages/Compliance"
import { Desk } from "./pages/Desk"
import { Empty } from "./components/ui"

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Desk />} />
        <Route path="bonds/:id/:tab?" element={<BondPage />} />
        <Route path="compliance" element={<Compliance />} />
        <Route path="activity" element={<Activity />} />
        <Route path="*" element={<Empty>Nothing at this address.</Empty>} />
      </Route>
    </Routes>
  )
}
