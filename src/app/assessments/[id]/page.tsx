import { AssessmentView } from "@/components/assessment-view";
export default async function AssessmentPage({params}:{params:Promise<{id:string}>}) { const {id}=await params; return <AssessmentView id={id}/>; }
