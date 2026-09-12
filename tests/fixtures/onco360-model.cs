using DataLayer;
using Model.Import;
using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Model.CQE;

namespace Model.Landing.Onco360.Model
{
    [ConnectionString(DataEngine.Registry.Onco360Model.ConnectionString)]
    [Table("Claim", Schema = DataEngine.Registry.Onco360Model.Schema)]
    public partial class Onco360Claim : ImportRow, ITPAImport 
    {
        [MaxLength(50)]
        [Column("StoreIdentifier", Order = 2)]
        public string StoreID { get; set; }

        [Column("DateOfDispense", Order = 3)]
        public DateTime? DateOfDispense { get; set; }

        [MaxLength(50)]
        [Column("RxNumber", Order = 4)]
        public string RxNumber { get; set; }

        [MaxLength(128)]
        [Column("PatientLastName", Order = 5)]
        public string PatientLastName { get; set; }

        [MaxLength(20)]
        [Column("PatientZip", Order = 6)]
        public string PatientZip { get; set; }

        [MaxLength(50)]
        [Column("340BID", Order = 7)]
        public string ID340B { get; set; }

        [MaxLength(50)]
        [Column("NDC", Order = 8)]
        public string Ndc { get; set; }

        [Column("Quantity", Order = 9)]
        public decimal? Quantity { get; set; }

        [Column("DaysSupply", Order = 10)]
        public int? DaysSupply { get; set; }

        [Required]
        [MaxLength(20)]
        [Column("TransactionCode", Order = 11)]
        public string TransactionCode { get; set; }

        [Column("GrossCharge", Order = 12)]
        public decimal? GrossCharge { get; set; }

        [NotMapped]
        public string TPAName { get; set; } = "Onco360";
    }
}
