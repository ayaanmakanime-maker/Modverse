import { redirect } from "next/navigation";

// The Atlas/Aura avatar builder was retired: fitting now happens in Human Studio.
export default function Page() { redirect("/design/human-studio"); }
